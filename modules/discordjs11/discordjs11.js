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


function init(loadAdditional){
	return new Promise((resolve, reject) => {
		let discordjsCommon = loadAdditional();

		let bot = discordjsCommon.djsinit();
		resolve(bot);
	});
}


function send_message(bot, channelId, content){
	try{
		let c = bot.channels.get(channelId);
		c.send(content);
	}catch(e){
		logger.error("Cannot send message to '" + channelId + "': " + e);
	}
}

function get_user(bot, userId){
	return bot.fetchUser(userId);
}

function resolve_user(bot, str, authorId){
	return new Promise((resolve, reject) => {
		if(!str){
			reject("User not found");
		}else if(str.toLowerCase() == "me"){
			resolve(authorId);
		}else if(!Number.isNaN(parseFloat(str))){
			resolve(str);
		}else if(str.startsWith("<@&")){ // role mention
			reject("User not found");
		}else if(str.startsWith("<@!")){
			resolve(str.substring(3, str.length - 1));
		}else if(str.startsWith("<@")){
			resolve(str.substring(2, str.length - 1));
		}else{
			for(let u of bot.users.array()){
				if(u.username.toLowerCase() == str.toLowerCase()){
					resolve(u.id);
					return;
				}
			}
			reject("User not found");
		}
	});
}


module.apply({
	init,
	custom: {},
	globals: {
		send_message,
		get_user,
		resolve_user
	},
	special: {}
});


