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

const fs = require("fs");
const path = require("path");

const modulesDir = path.resolve("modules");
const commandsDir = path.resolve("commands");
const identityFile = "identities.json";

let userIdentities = {};

function loadIdentities(){
	if(fs.existsSync(identityFile)){
		try{
			userIdentities = JSON.parse(fs.readFileSync(identityFile));
		}catch(e){
			logger.error("Error while loading user identities: " + e);
			userIdentities = {};
		}
	}else{
		userIdentities = {};
		saveIdentities();
	}
}

function saveIdentities(){
	try{
		fs.writeFileSync(identityFile, JSON.stringify(userIdentities, null, "\t"));
	}catch(e){
		logger.error("Error while saving user identities: " + e);
	}
}

function getNewId(){
	return Date.now().toString(16) + omzlib.util.randomHex8();
}


function identityRequest(instanceType, platformId, override){
	return new Promise((resolve, reject) => {
		loadIdentities();
		let c = false;
		if(!userIdentities[instanceType]){
			userIdentities[instanceType] = {};
			c = true;
		}
		if(override){
			userIdentities[instanceType][platformId] = override;
			c = true;
		}else if(!userIdentities[instanceType][platformId]){
			userIdentities[instanceType][platformId] = getNewId();
			c = true;
		} 
		if(c)
			saveIdentities();
		resolve(userIdentities[instanceType][platformId]);
	});
}

function getModules(){
	return new Promise((resolve, reject) => {
		let modFiles = fs.readdirSync(modulesDir);
		let modules = [];
		for(let f of modFiles){
			modules.push({name: path.basename(f, ".js"), data: fs.readFileSync(modulesDir + "/" + f)});
		}
		resolve(modules);
	});
}

function getCommand(cmd, args){
	return new Promise((resolve, reject) => {
		let cpath = path.resolve(commandsDir + "/" + cmd + ".js");
		if(!cpath.startsWith(commandsDir) || !fs.existsSync(cpath)){
			resolve({err: variables.errmsgOnUnknownCmd ? "Invalid Command" : true});
			return;
		}
		let modTime = fs.lstatSync(cpath).mtimeMs;
		let data;
		if(modTime > (args.mod || 0))
			data = fs.readFileSync(cpath);
		resolve({mod: modTime, data});
	});
}


module.exports = {
	identityRequest,
	getModules,
	getCommand
};

