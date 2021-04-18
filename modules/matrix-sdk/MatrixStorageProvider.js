"use strict";


const fs = require('fs');


class MatrixStorageProvider {

	constructor(file = "data.json"){
		this.file = file;

		this.data = {};

		this.data.appserviceUsers = {};
		this.data.appserviceTransactions = {};
		this.data.kvStore = {};

		this.loadData();
		setInterval(() => {
			this.saveData();
		}, 300000);
	}

	setSyncToken(token){
		this.data.syncToken = token;
	}

	getSyncToken(){
		return this.data.syncToken;
	}

	setFilter(filter){
		this.data.filter = filter;
	}

	getFilter(){
		return this.data.filter;
	}

	addRegisteredUser(userId){
		this.data.appserviceUsers[userId] = {
			registered: true,
		};
	}

	isUserRegistered(userId){
		return this.data.appserviceUsers[userId] && this.data.appserviceUsers[userId].registered;
	}

	isTransactionCompleted(transactionId){
		return !!this.data.appserviceTransactions[transactionId];
	}

	setTransactionCompleted(transactionId){
		this.data.appserviceTransactions[transactionId] = true;
	}

	readValue(key){
		return this.data.kvStore[key];
	}

	storeValue(key, value){
		this.data.kvStore[key] = value;
	}


	saveData(){
		fs.writeFileSync(this.file, JSON.stringify(this.data, null, "\t"));
	}

	loadData(){
		if(fs.existsSync(this.file)){
			this.data = JSON.parse(fs.readFileSync(this.file));
		}else{
			this.saveData();
		}
	}
}


module.exports = MatrixStorageProvider;

