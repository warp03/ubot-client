
const child_process = require('child_process');
const path = require('path');


let defRootPath = ".";
if(process.argv[2] && process.argv[2].startsWith("cwd:")){
	defRootPath = process.argv[2].substring(4);
}

var rootPath = rootPath || defRootPath;

const filename = "bot_client.js";


let restartIntervalTime = parseInt(process.argv[2]);
if(Number.isNaN(restartIntervalTime))
	restartIntervalTime = 0;
if(restartIntervalTime > 0 && restartIntervalTime < 5000)
	restartIntervalTime = 7200000; // 2 hours


let proc;
let restartInterval;

let exitRequest = false;


process.on("SIGINT", () => {
	log("Exiting");
	exitRequest = true;
	clearInterval(restartInterval);
	if(proc)
		proc.kill("SIGINT");
	else
		process.exit(0);
	setTimeout(() => {
		log("Timeout exceeded, terminating");
		if(proc)
			proc.kill("SIGTERM");
		process.exit(2);
	}, 5000).unref();
});


function log(str){
	console.log("[supervisor] " + str);
}

function spawn(){
	let cwd = rootPath;
	log("Running '" + process.argv[0] + " " + filename + "' in " + cwd);
	proc = child_process.spawn(process.argv[0], [filename, ...process.argv.slice(2, process.argv.length)], {cwd, stdio: 'inherit'});

	proc.on("error", (e) => {
		log("Error while running process: " + e);
	});

	proc.on("close", (code) => {
		log("Process exited with exit code " + code);
		proc = undefined;
		if(code == 130){
			log("Process requested to exit");
			exitRequest = true;
		}
		if(exitRequest)
			return;
		log("Restarting process in 3 seconds");
		setTimeout(() => {
			spawn();
		}, 3000);
	});
}


spawn();


if(restartIntervalTime){
	log("Setting restart interval for " + restartIntervalTime + "ms");
	restartInterval = setInterval(() => {
		if(proc){
			log("Restarting");
			proc.kill("SIGINT");
		}
	}, restartIntervalTime);
}


