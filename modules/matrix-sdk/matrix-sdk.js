/*
 * Copyright (C) 2021 user94729 (https://omegazero.org/) and contributors
 *
 * This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
 * If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Covered Software is provided under this License on an "as is" basis, without warranty of any kind,
 * either expressed, implied, or statutory, including, without limitation, warranties that the Covered Software
 * is free of defects, merchantable, fit for a particular purpose or non-infringing.
 * The entire risk as to the quality and performance of the Covered Software is with You.
 */
"use strict";

const sdk = require('matrix-bot-sdk');
const {MatrixClient} = sdk;
const MatrixStorageProvider = require("./MatrixStorageProvider");


let homeserverUrl = "https://matrix-client.matrix.org";


let storageProvider;

let syncMessages = false;


function init(loadAdditional, config){
	if(typeof(config.homeserver) == "string")
		homeserverUrl = config.homeserver;
	return new Promise((resolve, reject) => {
		storageProvider = new MatrixStorageProvider(instanceDir + "/matrix-data.json");

		let bot = new MatrixClient(homeserverUrl, undefined, storageProvider);

		let lastError = 0; // when server is unavailable, the client logs 100s of errors per second
		let omittedErrors = 0;

		sdk.LogService.setLevel(sdk.LogLevel.TRACE);
		sdk.LogService.setLogger({
			trace: (m, obj) => {
				bot.emit("trace", "[" + m + "] " + obj);
			},
			debug: (m, obj) => {
				bot.emit("debug", "[" + m + "] " + obj);
			},
			info: (m, obj) => {
				bot.emit("info", "[" + m + "] " + obj);
			},
			warn: (m, obj) => {
				bot.emit("warn", "[" + m + "] " + obj);
			},
			error: (m, obj) => {
				let time = Date.now();
				if(time - lastError < 5000){
					omittedErrors++;
				}else{
					if(omittedErrors)
						bot.emit("error", "Omitted " + omittedErrors + " error messages");
					omittedErrors = 0;
					bot.emit("error", "[" + m + "] " + obj);
					lastError = time;
				}
			}
		});

		resolve(bot);
	});
}

function login(bot, token){
	return new Promise((resolve, reject) => {
		bot.accessToken = token;
		bot.start().then(() => {
			if(!syncMessages)
				logger.debug("Sync debug messages disabled");
			bot.getUserId().then((str) => {
				bot._selfUserId = str;
				logger.info("Logged in as " + str);
				resolve();
			});
		});
	});
}

function close(bot){
	logger.info("Stopping");
	storageProvider.saveData();
	bot.stop();
}


function format(str){
	str = str.replace(/\</g, "&lt;").replace(/\>/g, "&gt;").replace(/\n/g, "<br />");
	let o = "";
	let open = {};
	for(let i = 0; i < str.length; i++){
		if(str[i] == "*"){
			if(str[i + 1] == "*"){
				if(open.bold){
					open.bold = false;
					o += "</strong>";
					i++;
				}else{
					open.bold = true;
					o += "<strong>";
					i++;
				}
			}else{
				if(open.em){
					open.em = false;
					o += "</em>";
				}else{
					open.em = true;
					o += "<em>";
				}
			}
		}else{
			o += str[i];
		}
	}
	return o;
}


function send_message(bot, channelId, content){
	bot.sendMessage(channelId, {
		msgtype: "m.text",
		body: content,
		format: 'org.matrix.custom.html',
		formatted_body: format(content)
	});
	/* image (todo):
	{
      body: 'test.png',
      info: [Object],
      msgtype: 'm.image',
      url: 'mxc://matrix.omegazero.org/[[id]]'
    }
    */
}

function get_user(bot, userId){
	return new Promise((resolve, reject) => {
		bot.getUserProfile(userId).then((userData) => {
			userData.id = userId;
			resolve(userData);
		}).catch(reject);
	});
}

function resolve_user(bot, str, authorId){
	return new Promise((resolve, reject) => {
		if(!str)
			reject("User not found");
		// <a href="https://matrix.to/#/@[[username]]:[[homeserver]]">[[username]]</a>
		let linkregex = /https\:\/\/matrix\.to\/\#\/\@.+\:.+\"/;
		if(str.toLowerCase() == "me"){
			resolve(authorId);
		}else if(linkregex.test(str)){
			let tstr = str.match(linkregex)[0];
			resolve(tstr.substring(20, tstr.length - 1));
		}else{
			get_user(bot, str).then((user) => {
				resolve(user.id);
			}).catch(() => {
				reject("User not found");
			});
		}
	});
}


module.apply({
	init,
	login,
	close,
	custom: {},
	globals: {
		send_message,
		get_user,
		resolve_user
	},
	special: {
		debugStr
	}
});


function debugStr(msg){
	if(msg.indexOf("sync") >= 0 && !syncMessages)
		return;

	return [msg];
}


