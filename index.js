const Discord = require('discord.js');
const icy = require('icy');
const fs = require('fs');
const util = require('util');
const {
  Readable,
  Writable,
  Transform,
  Duplex,
  pipeline,
  finished
} = require('readable-stream')
const {	Worker } = require("worker_threads");
const client = new Discord.Client({intents: ["GUILDS","GUILD_MESSAGES","GUILD_VOICE_STATES"]});
const {
	prefix,
	token,
	voicechannel,
	logchannel,
	timeout,
	list
} = require('./config.json');

const { joinVoiceChannel, 
		createAudioResource, 
		createAudioPlayer, 
		NoSubscriberBehavior, 
		entersState,
		StreamType,
		AudioPlayerStatus,
		VoiceConnectionStatus
	} = require('@discordjs/voice');

var serverQueue = [...list];

client.once('ready', () => {
	clientLogMessage("Status: Connected to discord");
	playStream();
});

client.once('reconnecting', () => {
	clientLogMessage("Status: Reconnected to discord");
	playStream();
});

client.once('disconnect', () => {
	clientLogMessage("Status: Disconnected from discord");
});

client.on('message', async message => {
	if (!message.content.startsWith(prefix) || message.author.bot) return;
	const args = message.content.slice(prefix.length).split(' ');
	const command = args.shift().toLowerCase();
});

client.login(token);

function playStream() {
	client.channels.fetch(voicechannel).then(channel => {
		const connection = joinVoiceChannel({
			channelId: channel.id,
			guildId: channel.guild.id,
			adapterCreator: channel.guild.voiceAdapterCreator
		});
		try {
		/**
		 * Allow ourselves 30 seconds to join the voice channel. If we do not join within then,
		 * an error is thrown.
		 */
		entersState(connection, VoiceConnectionStatus.Ready, 30e3);
		/**
		 * At this point, the voice connection is ready within 30 seconds! This means we can
		 * start playing audio in the voice channel.
		 */

		clientLogMessage("Status: Successfully connected to voice channel");
			
		connection.on("debug", e => {
				if (e.includes('[WS] >>') || e.includes('[WS] <<')) return;
				console.log("Status: Connection warning - " + e);
				//if(e.includes('[WS] closed')) abortWithError();
		});
		connection.on("disconnect", () => {
				clientLogMessage("Status: Connection disconnect");
		});
		connection.on("error", e => {
				clientLogMessage("Status: Connection error");
				console.log(e);
		});
		connection.on("failed", e => {
				clientLogMessage("Status: Connection failed");
				console.log(e);
		});
			
		initDispatcher(connection);
	} catch (error) {
		/**
		 * At this point, the voice connection has not entered the Ready state. We should make
		 * sure to destroy it, and propagate the error by throwing it, so that the calling function
		 * is aware that we failed to connect to the channel.
		 */
		console.log("destroying connection...");
		connection.destroy();
		throw error;
	}
	
	}).catch(e => {
		clientLogMessage("Status: Channel not found");
		console.log(e);
	});
}

const player = createAudioPlayer(
    {
		debug:false,
		behaviors: {
			noSubscriber: NoSubscriberBehavior.Pause,
		},
	}
);	
	
function initDispatcher(connection) {
	clientLogMessage("Status: Broadcast started");
	
	if (serverQueue === undefined || serverQueue.length == 0) {
		clientLogMessage("Status: Repeating entire playlist");
		serverQueue = [...list];
	}
	const currentTrack = serverQueue.shift();

	const resource = createAudioResource(currentTrack.url,
		{
			inputType: StreamType.Arbitrary,
			inlineVolume: true
		});
	resource.volume.setVolume(0.5);	
	
	const subscription = player.subscribe(connection);
	
	player.play(resource);


	player.on("debug", e => {
		console.log("Debug: Player warning - " + e);
	});
	player.on("error", e => {
		clientLogMessage("Status: Broadcast connection error");
		console.log(e);
		abortWithError(connection);
	});
	
	getICY(currentTrack.url,connection);
	
	entersState(player, AudioPlayerStatus.Playing, 5e3);
	 
	
}
var worker;
function getICY(url,connection) {
	console.log("Playing from "+url);
	const icyReader = icy.get(url, function (i) {
		//console.error("headers:"+JSON.stringify(i.headers));
		if (i.headers && i.headers.connection==="close") {
			//redirect 
			getICY(i.headers.location,connection);
		} else {
			i.on('metadata', function (metadata) {
				//console.error(metadata);
				let icyData = icy.parse(metadata);
				//console.error(icyData);
				if (icyData.StreamTitle) changeActivity(icyData.StreamTitle);
			});
			i.resume();
			i.pipe(new StreamMonitor());
			// Create new worker
			worker = new Worker("./worker.js", {
				workerData: {
					num: timeout
				}
			});

			// Listen for a message from worker
			worker.once("message", result => {
				console.log(`Message from worker: ${result}`);
			});
			worker.on("error", (error) => {
				console.log(`Error from worker: ${error}`);
			});
			worker.on("exit", (exitCode) => {
				console.log(`Exit from worker: ${exitCode}`);
				clientLogMessage("Error: No data from the stream for "+timeout+" ms, restarting...");
				abortWithError(connection);
			});
		}
	});
}

function abortWithError(connection) {
	try {
	  client.user.setActivity(message, {type: 'IDLE'});
	}
	catch(e)
	{
	}
	var message=getFmtTime()+" "+"Status: The connection to the radio station is interrupted or it does not respond, interrupting the process";
	console.log(message);
	const channel = client.channels.cache.get(logchannel);
	channel.send(message).then (msg => {
		connection.destroy();
		client.destroy();
		process.exit(1);
	});
}

function clientLogMessage(message) {
	//client.channels.fetch(logchannel).then(channel => {
	//	channel.send(message);
	//}).catch(e => console.log(e));
	
	const channel = client.channels.cache.get(logchannel);
	channel.send(message);
	
	console.log(message);
}

function getFmtTime() {
	let date = new Date();  
	let options = {  
		weekday: "long", year: "numeric", month: "short",  
		day: "numeric", hour: "2-digit", minute: "2-digit"  
	};  

	return "["+date.toLocaleTimeString("pl-pl", options)+"]";
}

function changeActivity(message) {
	clientLogMessage(getFmtTime()+" "+ message);
	client.user.setActivity(message, {
		type: 'LISTENING'
	});;
}


var last_timestamp=new Date().getTime();

function StreamMonitor (opts) {
  if (!(this instanceof StreamMonitor)) {
    return new StreamMonitor(opts);
  }
  Transform.call(this, opts);
  console.log('created new StreamMonitor instance');
}
util.inherits(StreamMonitor, Transform);

StreamMonitor.prototype._transform = function (chunk, encoding, done) {
//  console.log('_transform(): (%d bytes)', chunk.length);
  last_timestamp=new Date().getTime();
  worker.postMessage(last_timestamp);
  done();
};
