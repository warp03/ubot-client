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
const readline = require("readline");
const EventEmitter = require("events");
const vm = require("vm");

const omzlib = require("./omz-js-lib");
const logger = omzlib.logger;

const baseStructures = require("./baseStructures");


const VERSION = "3.2.2";
const BRAND = "UBot client v" + VERSION;


const pargs = new omzlib.args(process.argv);

const configFile = path.resolve(pargs.getValueOrDefault("config", "botData/config.json"));
const config = require(configFile);

const instanceDir = path.resolve(pargs.getValueOrDefault("instanceDir", path.dirname(configFile)));


let logLevel = pargs.getNumberOrDefault("logLevel", 3);
let logFile = instanceDir + "/" + pargs.getValueOrDefault("logFile", "log");



class Bot extends EventEmitter{
	constructor(){
		super();
		this.started = Date.now()
	}

	get uptime(){
		return Date.now() - this.started;
	}
}


const botGlobals = {};

let bot = new Bot();
let botInstances = {};
let botInit = false;

let provider = {};

let variableData = {
	_changeHandlers: {},
	setChangedHandler: (key, handler) => {
		if(typeof(handler) == "function")
			variableData._changeHandlers[key] = handler;
	},
	exists: (key) => {
		return variableData[key] != undefined;
	}
};
let variables = new Proxy(variableData, {
	set: (target, key, value) => {
		let a = true;
		if(variableData._changeHandlers[key]){
			a = !!variableData._changeHandlers[key](key, value);
		}
		if(a)
			variableData[key] = value;
		return a;
	}
});

let cd = [];

let modules = {}; // modules data, similar to botData
let botData = {};
let globalEventHandler = new EventEmitter();

let commandCache = {};
let loadedModules = [];

let lastCommand = {};

const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout
});

const stats = {
	messagesProcessed: 0,
	commandsProcessed: 0
};

const builtinModules = ["http", "https", "http2", "net", "tls", "child_process", "crypto", "dns", "events", "os", "url",
	"readline", "stream", "tty", "vm", "worker_threads", "zlib"];
const virtualModules = {
	fs: {},
	path: {}
};

const moduleContext = {omzlib, instanceDir, bot, botInstances, variables, cd, modules, botData, require: virtualRequire, convertToType, VERSION, BRAND,
	getTimeReadable, getUTCDateReadable, stats, global, config, globalEventHandler, Buffer, userIdentityRequest, shutdown, exit};


start();


function start(){
	try{
		preinit();

		init();
	}catch(e){
		logger.fatal("Error during initialization: " + e);
		logger.consoleLog(e);
		shutdown(1);
	}

}


function preinit(){
	logger.init(logLevel, logFile);

	omzlib.util.initPrototypes();

	omzlib.util.initHandlers(shutdown, undefined, () => {
		if(!lastCommand.reported && lastCommand.time && Date.now() - lastCommand.time < 3000){
			if(!variables.mute)
				lastCommand.channel.send("[ERROR] Error while running last command or background task, check console or log for details");
			lastCommand.reported = true;
		}
	});


	Object.resolve = function(object, name){
		let a = name.split(".");
		let o = object;
		for(let i = 0; i < a.length; i++){
			let t = a[i];
			if(t in o){
				o = o[t];
			}else
				return;
		}
		return o;
	};
	// Object.assign doesnt really work for nested objects (even if the object in target already exists, it gets overwritten)
	Object.copy = function(target, source, recursive = false){
		for(let a in source){
			let src = source[a];
			if(typeof(src) == "object" && recursive){
				if(typeof(target[a]) != "object")
					target[a] = {};
				Object.copy(target[a], src, recursive);
			}else
				target[a] = src;
		}
		return target;
	};


	if(pargs.getValue("enableConsole")){
		logger.debug("Console is enabled");
		rl.on('line', (input) => {
			consoleEval(input);
		});
	}
	rl.on("SIGINT", exit);


	virtual_modules_init();


	provider_load();

	const providerUnimplemented = () => {
		return new Promise((resolve, reject) => {
			reject(new Error("Unimplemented"));
		});
	};

	provider_attach("preinit");
	provider_attach("init", () => {
		return new Promise((resolve, reject) => {
			resolve();
		});
	});
	provider_attach("loginComplete");
	provider_attach("sendLog");
	provider_attach("close");

	provider_attach("addStats");
	provider_attach("identityRequest", providerUnimplemented);
	provider_attach("getModules", providerUnimplemented);
	provider_attach("getCommand", providerUnimplemented);


	botglobal_add_handler("send_message"); // send_message(platformChannelId, content)
	botglobal_add_handler("send_message_to_user"); // send_message_to_user(platformUserId, content)
	botglobal_add_handler("get_user", function(instanceType, userId){
		return new Promise((resolve, reject) => {
			botInstances[instanceType].mod.globals.get_user(botInstances[instanceType].vbot, userId).then(async (instanceUser) => {
				bot_get_type(instanceType, "user", instanceUser).then(resolve).catch(reject);
			}).catch(reject);
		});
	});
	botglobal_add_handler("resolve_user", function(instanceType, str, authorId){
		return new Promise((resolve, reject) => {
			botInstances[instanceType].mod.globals.resolve_user(botInstances[instanceType].vbot, str, authorId).then((platformId) => {
				botGlobals.get_user(instanceType, platformId).then(resolve).catch(reject);
			}).catch(reject);
		});
	});

	bot.sendMessage = botGlobals.send_message;
	bot.sendMessageToUser = botGlobals.send_message_to_user;
	bot.fetchInstanceUser = botGlobals.get_user;
	bot.resolveInstanceUser = botGlobals.resolve_user;


	let cmdVars = pargs.getValueOrDefault("setvar", "").split(";");
	logger.debug(cmdVars.length + " command line variables");
	for(let cv of cmdVars){
		let cva = cv.split(":");
		if(cva.length < 2)
			continue;
		variables[cva[0]] = convertToType(decodeURIComponent(cva[1]));
	}


	let logCallback = (str, level) => {
		logger.setLogCallback(0);
		// sendLog may have logs and also calls the callback, so not temporarily resetting the callback can cause stack overflow
		provider.sendLog("[" + level + "] " + str);
		logger.setLogCallback(logCallback);
	};
	logger.setLogCallback(logCallback);


	logger.info(BRAND);

	provider.preinit();
}

function init(){
	globalEventHandler.on("_checkCommandPermission", (user, cmd, deny) => {
		if(cmd.startsWith("internal.")){
			let allowed = false;
			let ownerIds = (pargs.getValue("ownerId") || variables.ownerId || "").split(",");
			for(let oid of ownerIds){
				if(oid == user.uid){
					allowed = true;
					break;
				}
			}
			if(!allowed)
				deny();
		}
	});

	provider.init().then(() => {
		bot_init().then(() => {
			try{
				provider.loginComplete();
			}catch(e){
				logger.error("Error in loginComplete: " + e);
			}
			logger.debug("Requesting modules");
			reloadModules();
		}).catch((e) => {
			logger.fatal("Bot initialization failed: " + e);
			logger.consoleLog(e);
			shutdown(1);
		});
	}).catch((e) => {
		logger.fatal("Base handler initialization failed: " + e);
		logger.consoleLog(e);
		shutdown(1);
	});
}

function close(){
	unloadModules();
	logger.info("Closing");
	bot_close();
	if(provider.close)
		provider.close();
}

function exit(){
	shutdown(130);
}

function shutdown(status){
	setTimeout(() => {
		if(status == 130)
			process.exit(130);
		else
			process.exit(2);
	}, 2000).unref();
	close();
	rl.close();
	logger.close();
	if(typeof(status) == "number")
		process.exitCode = status;
}

function restart(){
	close();
	modules = {};
	botData = {};
	globalEventHandler = new EventEmitter();
	commandCache = {};
	loadedModules = [];
	lastCommand = {};
	setTimeout(() => {
		botInit = false;
		bot = new Bot();
		init();
	}, 2000);
}


function provider_load(){
	provider = provider_load_file(pargs.getValueOrDefault("provider", "basic"));
}

function provider_load_file(name, dir = "./providers"){
	logger.debug("Loading provider '" + name + "'");
	let vmodule = {
		apply: (obj) => {
			Object.copy(vmodule.exports, obj, true);
		},
		exports: {}
	};
	vm.runInContext(fs.readFileSync(dir + "/" + name + ".js").toString(),
		createNewModuleContext({
			logger: createLoggerFor("base"),
			module: vmodule,
			loadAdditional: provider_load_file
		}));
	if(typeof(vmodule.exports) != "object"){
		throw new Error("Data returned by provider is not an object");
	}
	return vmodule.exports;
}

function provider_attach(name, defHandler){
	if(typeof(provider[name]) != "function"){
		provider[name] = defHandler || (() => {});
	}
}

function virtual_modules_init(){
	const virtualScope = {instanceDir, fs, path};
	const fsFunctions = ["access", "accessSync", "appendFile", "appendFileSync", "chmod", "chmodSync", "chown", "chownSync", "createReadStream", "createWriteStream",
		"exists", "existsSync", "lchmod", "lchmodSync", "lchown", "lchownSync", "lutimes", "lutimesSync", "lstat", "lstatSync", "mkdir", "mkdirSync", "open", "opendir",
		"opendirSync", "openSync", "readdir", "readdirSync", "readFile", "readFileSync", "readlink", "readlinkSync", "realpath", "realpathSync", "rmdir", "rmdirSync",
		"rm", "rmSync", "unwatchFile", "utimes", "utimesSync", "watch", "watchFile", "writeFile", "writeFileSync"];
	for(let f of fsFunctions){
		virtualModules.fs[f] = new Function("let args = Array.from(arguments).splice(1, arguments.length);return this.fs." + f
			+ "((this.path.isAbsolute(arguments[0]) ? '' : (this.instanceDir + '/')) + arguments[0], ...args);").bind(virtualScope);
	}

	const pathFunctions = ["basename", "delimiter", "dirname", "extname", "format", "isAbsolute", "join", "normalize", "parse", "posix", "sep", "toNamespacedPath", "win32"];
	for(let f of pathFunctions){
		virtualModules.path[f] = path[f];
	}
	virtualModules.path.resolve = new Function('let p = "";for(let i = arguments.length - 1; i >= 0; i--){p += (i == arguments.length - 1 ? "" : this.path.sep)'
		+ ' + arguments[i];if(this.path.isAbsolute(p))break;}if(!this.path.isAbsolute(p))p = this.instanceDir + this.path.sep + p;return p;').bind(virtualScope);
}

function botglobal_add_handler(name, handler){
	if(typeof(handler) == "function"){
		botGlobals[name] = handler;
	}else{
		botGlobals[name] = function(instanceType){
			let args = [];
			for(let i = 1; i < arguments.length; i++)
				args[i - 1] = arguments[i];
			return botInstances[instanceType].mod.globals[name](botInstances[instanceType].vbot, ...args);
		};
	}
}


async function bot_init(){

	if(!variables.exists("errmsgOnUnknownCmd"))
		variables.errmsgOnUnknownCmd = false;
	if(!variables.exists("cmdPrefix"))
		variables.cmdPrefix = "!";
	if(!variables.exists("ignoreDMs"))
		variables.ignoreDMs = true;

	if(!botInit){
		botInit = true;

		bot.on("trace", (str) => {
			logger.trace("[bot] " + str);
		});

		bot.on("debug", (str) => {
			logger.debug("[bot] " + str);
		});

		bot.on("info", (str) => {
			logger.info("[bot] " + str);
		});

		bot.on("warn", (str) => {
			logger.warn("[bot] " + str);
		});

		bot.on("error", (str) => {
			logger.error("[bot] " + str);
		});

		bot.on("message", bot_on_message);
	}

	for(let type in config.auth){
		if(botInstances[type])
			continue;
		logger.debug("Initializing bot type '" + type + "'");

		let token = config.auth[type];

		let meta = require("./types/" + type);

		let modName = meta.module;
		if(typeof(config.versionOverride) == "object" && config.versionOverride[type]){
			modName += config.versionOverride[type];
		}else if(meta.defaultVersion){
			modName += meta.defaultVersion;
		}

		let modConfig = {};
		if(typeof(config.moduleConfig) == "object" && typeof(config.moduleConfig[type]) == "object")
			modConfig = config.moduleConfig[type];

		let vmodule = {
			apply: (obj) => {
				Object.copy(vmodule.exports, obj, true);
			},
			exports: {}
		};
		let typeContext = createNewModuleContext({
			logger: createLoggerFor(type, "platform"),
			provider,
			require: (name) => {
				return virtualRequire(name, modName);
			},
			module: vmodule
		});
		let modData = fs.readFileSync("./modules/" + modName + "/" + modName + ".js").toString();
		vm.runInContext(modData, typeContext);
		let mod = vmodule.exports;

		let vbot = await mod.init((name) => {
			name = name || meta.module;
			let modData = fs.readFileSync("./modules/" + name + "/" + name + "_common.js").toString();
			vm.runInContext(modData, typeContext);
			return vmodule.exports;
		}, modConfig);
		botInstances[type] = {type, mod, vbot, meta};

		for(let event in baseStructures.events){
			if(typeof(meta.eventTransformers[event]) != "object")
				continue;
			bot_add_event_handler(botInstances[type], event, baseStructures.events[event], meta.eventTransformers[event]);
		}

		await mod.login(vbot, token);
		logger.debug("Bot type '" + type + "' login completed");
	}
}

function bot_close(){
	try{
		for(let type in botInstances){
			if(typeof(botInstances[type].mod.close) == "function")
				botInstances[type].mod.close(botInstances[type].vbot);
			delete botInstances[type];
		}
	}catch(e){
		logger.fatal("Error while closing bot: " + e);
		logger.consoleLog(e);
	}
}


async function bot_transform_object(instance, baseArg, transformerArg, sourceArgs, sourceIndex){
	if(typeof(transformerArg) != "object")
		throw new TypeError("transformerArg is not an object");
	if(typeof(baseArg) == "object"){
		let obj = {};
		for(let p in baseArg){
			if(p == "includeInstance")
				continue;
			if(typeof(transformerArg[p]) == "object"){
				obj[p] = await bot_transform_object(instance, baseArg[p], transformerArg[p], sourceArgs, sourceIndex);
				if(obj[p] && baseStructures.identityTransformKeys.indexOf(p) >= 0){
					obj[p + "_original"] = obj[p];
					obj[p] = await provider.identityRequest(instance.type, obj[p]);
				}
			}else
				obj[p] = null;
		}
		if(baseArg.includeInstance)
			obj.client = instance;
		if(typeof(transformerArg.includeOriginal) == "number")
			obj._platformInstance = sourceArgs[transformerArg.includeOriginal];
		return obj;
	}else if(typeof(baseArg) == "string" && baseArg.startsWith("type:")){
		let typeName = baseArg.substring(5);
		let valueArg = sourceArgs[transformerArg.typeArgIndex];
		if(!valueArg)
			return null;
		let value = transformerArg.typeProperty ? Object.resolve(valueArg, transformerArg.typeProperty) : valueArg;
		if(transformerArg.botGlobalsData)
			return await botGlobals[transformerArg.botGlobalsData](instance.type, value);
		else
			return await bot_get_type(instance.type, typeName, value);
	}else{
		let argIndex = transformerArg.argIndex;
		if(typeof(argIndex) != "number")
			argIndex = sourceIndex;
		if(!sourceArgs[argIndex] && !(transformerArg.evalScript || transformerArg.constant))
			return null;
		let value;
		if(transformerArg.property)
			value = Object.resolve(sourceArgs[argIndex], transformerArg.property);
		else if(transformerArg.evalScript)
			value = eval("(" + transformerArg.evalScript + ")");
		else if(transformerArg.script){
			let func = new Function("arg", "instance", "return (" + transformerArg.script + ")");
			value = func(sourceArgs[argIndex], instance);
		}else if(transformerArg.constant)
			value = transformerArg.constant;
		else
			value = sourceArgs[argIndex];
		if(typeof(value) != baseArg)
			return null;
		return value;
	}
}

function bot_add_event_handler(instance, event, base, transformer){
	instance.vbot.on(transformer.event, async function(){
		try{
			let start = Date.now();
			let args = [];
			for(let i = 0; i < base.length; i++){
				if(typeof(transformer.args[i]) == "object")
					args[i] = await bot_transform_object(instance, base[i], transformer.args[i], arguments);
			}
			if(typeof(transformer.special) == "string" && typeof(instance.mod.special) == "object" && typeof(instance.mod.special[transformer.special]) == "function"){
				args = instance.mod.special[transformer.special](...args);
			}
			logger.trace("Transform ['" + instance.type + "." + transformer.event + "' -> '" + event + "'] completed in " + (Date.now() - start) + "ms");
			if(Array.isArray(args)){
				try{
					bot.emit(event, ...args);
				}catch(e){
					logger.error("Error while running event '" + event + "': " + e);
					logger.consoleLog(e);
				}
			}
		}catch(e){
			logger.error("Error while transforming event '" + transformer.event + "' (-> '" + event + "') by " + instance.type + ": " + e);
			logger.consoleLog(e);
		}
	});
}

async function bot_get_type(instanceType, dataType, data){
	if(!baseStructures.types[dataType])
		return;
	let i = botInstances[instanceType];
	let o;
	if(typeof(i.meta.typeTransformers) == "object" && typeof(i.meta.typeTransformers[dataType]) == "object"){
		o = await bot_transform_object(i, baseStructures.types[dataType], i.meta.typeTransformers[dataType], [data], 0);
	}
	o._platformInstance = data;
	return o;
}


function bot_on_message(message){
	stats.messagesProcessed++;
	if(message.content.startsWith(variables.cmdPrefix) || (variables.cmdPrefixAlt && message.content.startsWith(variables.cmdPrefixAlt))){
		if(variables.ignoreDMs && message.dm){
			logger.warn("Ignoring DM from " + message.author.uid + ": " + message.content);
			return;
		}

		logger.info("Command by " + message.author.username + " (" + message.client.type + "): " + message.content);
		lastCommand.time = Date.now();
		lastCommand.channel = message.channel;
		lastCommand.reported = false;
		stats.commandsProcessed++;

		let args = message.content.substring(variables.cmdPrefix.length).split(" ");
		let cmd = args[0];
		runCommand(message, cmd, args);
	}
}


function reloadModules(){
	unloadModules();
	provider.getModules().then((modules) => {
		if(!Array.isArray(modules)){
			logger.warn("Modules is not an array");
		}else{
			logger.debug("Received " + modules.length + " modules");
			for(let m of modules){
				const moduleData = {};
				try{
					vm.runInContext(m.data.toString(),
						createNewModuleContext({
							logger: createLoggerFor(m.name, "module"),
							provider,
							moduleData,
							runCommand,
							runExternalCommand
						}));
					moduleData.load();
				}catch(e){
					logger.error("Error while loading module '" + m.name + "': " + e);
				}
				if(typeof(moduleData.load) == "function" && typeof(moduleData.unload) == "function"){
					moduleData.name = m.name;
					loadedModules.push(moduleData);
					logger.debug("Loaded module '" + m.name + "'");
				}else{
					logger.warn("Ignoring invalid module '" + m.name + "'");
				}
			}
		}
	}).catch((e) => {
		logger.error("Error while loading modules: " + e);
	});
}

function unloadModules(){
	for(let m of loadedModules){
		logger.debug("Unloading module '" + m.name + "'");
		try{
			m.unload();
		}catch(e){
			logger.error("Error while unloading module '" + m.name + "': " + e);
		}
	}
	loadedModules = [];
}


function runCommand(message, cmd, args){
	let allowed = true;
	let denyInfo;
	globalEventHandler.emit("_checkCommandPermission", message.author, cmd, (info) => {
		allowed = false;
		if(denyInfo)
			denyInfo += ", " + info;
		else
			denyInfo = info;
	});
	if(!allowed){
		if(!variables.mute)
			message.reply("Permission Denied" + (denyInfo ? (": " + denyInfo) : ""));
		return;
	}

	if(cmd == "stats"){
		if(variables.mute)
			return;
		let meta = botInstances[message.client.type];
		if(typeof(meta.mod.custom) == "object" && typeof(meta.mod.custom.stats) == "function"){
			meta.mod.custom.stats(meta.vbot, message);
		}else{
			message.channel.send("**Stats**:\nUptime: " + getTimeReadable(bot.uptime) + "\nMessages: " + stats.messagesProcessed
				+ "\nCommands: " + stats.commandsProcessed + "\n" + (provider.addStats("default", []) || ""));
		}
	}else if(cmd.startsWith("internal.")){
		cmd = cmd.split(".")[1];

		if(cmd == "test"){
			if(!variables.mute)
				message.reply("Success");
		}else if(cmd == "setvar"){ // <key> <value>
			if(args.length > 2){
				let value = args[2];
				for(let i = 3; i < args.length; i++)
					value += " " + args[i];
				variables[args[1]] = convertToType(value);
			}else if(!variables.mute)
				message.reply("At least two arguments required");
		}else if(cmd == "getvar"){
			if(args.length > 1){
				if(!variables.mute)
					message.reply(variables[args[1]]);
			}else if(!variables.mute)
				message.reply("At least one argument required");
		}else if(cmd == "exit"){
			exit();
		}else if(cmd == "shutdown"){
			shutdown(0);
		}else if(cmd == "uptime"){
			if(!variables.mute)
				message.reply("Uptime: " + getTimeReadable(bot.uptime));
		}else if(cmd == "setCDMessage"){
			cd[502] = message;
		}else
			if(!variables.mute)
				message.reply("Unknown internal command");
	}else{
		runExternalCommand(message, cmd, args, () => {});
	}
}

function runExternalCommand(message, cmd, args, commandCallback){
	if(typeof(commandCallback) != "function")
		commandCallback = () => {};
	let cached = commandCache[cmd];
	provider.getCommand(cmd, {mod: cached ? cached.mod : 0, groupId: message.group ? message.group.gid : undefined, authorId: message.author.uid}).then((data) => {
		if(data.err !== undefined){
			if(!variables.mute && typeof(data.err) == "string")
				message.reply(data.err);
			return;
		}
		if(!cached){
			cached = {};
			commandCache[cmd] = cached;
		}
		cached.mod = data.mod;
		if(data.data){
			cached.data = data.data;
		}
		if(!cached.data){
			if(!variables.mute)
				message.channel.send("[ERROR] Internal error: No command data is available");
			logger.error("No command data is available for '" + cmd + "'");
			return;
		}
		let writeError = () => {
			if(!variables.mute)
				message.channel.send("[ERROR] Error in command **" + cmd + "**, check console or log for details");
		};
		let commandAlias = (name) => {
			runExternalCommand(message, name, args, commandCallback);
		};
		if(typeof(commandCallback) != "function")
			commandCallback = () => {};
		let vbot = botInstances[message.client.type].vbot;
		vm.runInContext("(async function(){" + cached.data + "})();",
			createNewModuleContext({
				logger: createLoggerFor(cmd, "cmd"),
				provider,
				message, cmd, args, commandCallback, commandAlias, runCommand, runExternalCommand, writeError
			})
		).catch((e) => {
			logger.error("Error while running command '" + cmd + "': " + e);
			logger.consoleLog(e);
			writeError();
		});
	}).catch((e) => {
		logger.error("Error while getting command '" + cmd + "': " + e);
		if(!variables.mute)
			message.channel.send("[ERROR] Internal Error");
	});
}


function userIdentityRequest(type, platformId, override){
	return provider.identityRequest(type, platformId, override);
}


function virtualRequire(name, moduleDir = ""){
	logger.trace("Virtual require: '" + name + "' in '" + moduleDir + "'");
	if(virtualModules[name]){
		return virtualModules[name];
	}else{
		if(builtinModules.indexOf(name) >= 0)
			return require(name);
		if(name.startsWith("./")){
			if(moduleDir)
				name = "./modules/" + moduleDir + "/" + name;
			else
				name = instanceDir + "/" + name;
		}else if(!path.isAbsolute(name)){
			if(moduleDir)
				name = "./modules/" + moduleDir + "/node_modules/" + name;
			else
				name = instanceDir + "/node_modules/" + name;
		}
		return require(name);
	}
}


function createNewModuleContext(exObj){
	let nc = Object.copy({}, moduleContext);
	Object.copy(nc, global);
	if(typeof(exObj) == "object")
		Object.copy(nc, exObj);
	vm.createContext(nc);
	return nc;
}

function createLoggerFor(name, type){
	const logLevels = ["trace", "debug", "info", "warn", "error", "fatal"];
	let nlogger = {};
	let addLevel = (level) => {
		nlogger[level] = (str) => {
			logger[level]("[" + (type ? (type + "/") : "") + name + "] " + str);
		}
	};
	for(let l of logLevels){
		addLevel(l);
	}
	nlogger.consoleLog = logger.consoleLog;
	return nlogger;
}


function convertToType(data){
	if(data == "true")
		return true;
	else if(data == "false")
		return false;
	else if(!Number.isNaN(parseInt(data)))
		return parseInt(data);
	else
		return data;
}

function getTimeReadable(time){
	return Math.floor(time / 60000 / 60) + "h " + Math.floor(time / 60000 % 60) + "min " + Math.floor((time / 1000 % 60) * 100) / 100 + "s";
}

function getUTCDateReadable(ctime){
	return new Date(ctime).toUTCString();
}


function consoleEval(input){
	try{
		var res = eval(input);
		logger.consoleLog(res);
	}catch(err){
		logger.consoleLog("Error: " + err);
	}
}


