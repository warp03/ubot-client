# UBot client

Platform-independent bot client, allowing you to use the same code for commands for different platforms.\
Multiple bot instances may also be run in parallel using a single installation.

Currently, only [Discord](https://discord.com/) and [Matrix](https://matrix.org/) are supported.


## Installation

Download source code:
```bash
git clone --recurse-submodules https://git.omegazero.org/user94729/ubot-client.git
cd ubot-client
```

### Install the npm packages for the platforms you want to support
You will only need to install the packages if a token for the platform was specified (See **Simple Configuration** below).

#### Discord
**Discord.js version 12**
```bash
cd modules/discordjs12
npm install discord.js@12.5.3
```
**Discord.js version 11**
```bash
cd modules/discordjs11
npm install discord.js@11.6.4
```

#### Matrix
```bash
cd modules/matrix-sdk
npm install matrix-bot-sdk
```

## Simple Configuration

Create a directory in the installation directory called `botData`. This is the default data directory for an instance.\
Create a file called `config.json` in the new folder with this content:
```json
{
	"auth": {
		"discordjs": "<discord token here>",
		"matrix-sdk": "<matrix token here>"
	}
}
```
Either token is optional, but set at least one.

Commands and modules are stored in the `commands` and `modules` subdirectory in the data directory, respectively.

## Usage
...

