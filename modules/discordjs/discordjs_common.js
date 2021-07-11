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

const discordjs = require("discord.js");

let discordjsVersionMajor = parseInt(discordjs.version.split(".")[0]);


let discordConnected = 0;
let disconnectsDiscord = 0;


function djsinit(){
	let bot = new discordjs.Client();
	bot.discordjsVersion = discordjs.version;
	bot.discordjsVersionMajor = discordjsVersionMajor;

	bot.on('disconnect', function(){
		logger.info("Bot Disconnected");
	});

	bot.on('guildCreate', (guild) => {
		logger.info("Joined server " + guild.name);
	});

	bot.on('guildDelete', (guild) => {
		logger.info("Left server " + guild.name);
	});

	bot.on('rateLimit', (info, limit, timeDifference, path, method) => {
		logger.info("Bot is being rate limited (" + method + " " + path + ")");
	});

	if(discordjsVersionMajor <= 11){
		bot.on('reconnecting', () => {
			logger.info("Bot is reconnecting");
			disconnectsDiscord++;
		});
	}

	logger.debug("Heartbeat debug messages are disabled");

	return bot;
}

function login(bot, token){
	return new Promise((resolve, reject) => {
		bot.on('ready', () => {
			logger.info("Logged in as: " + bot.user.tag);
			resolve();
		});

		bot.login(token);
	});
}

function close(bot){
	logger.info("Logging out");
	bot.destroy();
}


module.apply({
	djsinit,
	login,
	close,
	custom: {
		stats: statsMsg
	},
	globals: {},
	special: {
		debugStr
	},
	discordjsVersionMajor
});


function statsMsg(bot, message){
	let currentTime = Date.now();
	let embed = new (discordjsVersionMajor <= 11 ? discordjs.RichEmbed : discordjs.MessageEmbed)();
	embed.setColor("#000000");
	embed.setTitle(bot.user.username + " stats");
	embed.setThumbnail(discordjsVersionMajor <= 11 ? bot.user.avatarURL : bot.user.avatarURL());
	embed.addField("General", "Uptime: " + getTimeReadable(bot.uptime) + "\nMessages: " + stats.messagesProcessed + "\nCommands: " + stats.commandsProcessed
			+ "\nServer time: " + getUTCDateReadable(currentTime) + "\n");
	embed.addField("Discord API service", "Connected since: " + getUTCDateReadable(discordConnected)
			+ " (" + getTimeReadable(currentTime - discordConnected) + ")\nDisconnects: " + disconnectsDiscord + "\n");
	let bbrand;
	let bstats = provider.addStats("discordjs", [embed, (brand) => {bbrand = brand;}]);
	if(typeof(bstats) == "string")
		embed.addField("Base", bstats);
	embed.setTimestamp();
	embed.setFooter("omz-js-lib version " + omzlib.meta.version + " / " + BRAND + " / discord.js version " + discordjs.version + (bbrand ? (" / " + bbrand) : ""),
		"https://static.omegazero.org/p/w/icon_transparent.png");
	message.channel.send(embed);
}

function debugStr(msg){
	if(msg.indexOf("Sending a heartbeat") >= 0 || msg.indexOf("Heartbeat acknowledged, latency of ") >= 0)
		return;

	if(discordjsVersionMajor > 11 && msg.indexOf("CONNECTED") >= 0)
		discordConnected = Date.now();
	else if(discordjsVersionMajor <= 11 && msg.indexOf("Connected to gateway") >= 0)
		discordConnected = Date.now();

	if(discordjsVersionMajor > 11 && msg.indexOf("RECONNECT") >= 0)
		disconnectsDiscord++;

	if(discordjsVersionMajor > 11 && msg.indexOf("VOICE") >= 0 && (msg.indexOf("<<") >= 0 || msg.indexOf(">>") >= 0))
		return;

	return [msg.split("\n")[0]];
}


