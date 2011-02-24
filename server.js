HOST = null; // localhost
PORT = 8374;

// when the daemon started
var starttime = (new Date()).getTime();

var mem = process.memoryUsage();
// every 10 seconds poll for the memory.
setInterval(function () {
  mem = process.memoryUsage();
}, 10*1000);


var fu = require("./fu"),
    sys = require("sys"),
    url = require("url"),
    qs = require("querystring");

var MESSAGE_BACKLOG = 200,
    SESSION_TIMEOUT = 60 * 1000;

var channel = new function () {
  var rooms = [];

  //var messages = [],
  //    callbacks = [];

  this.appendMessage = function (nick, type, text) {
    var m = { nick: nick
            , type: type // "msg", "join", "part"
            , text: text
            , timestamp: (new Date()).getTime()
            };

    switch (type) {
      case "msg":
        sys.puts("<" + nick + "> " + text);
        break;
      case "join":
        sys.puts(nick + " join");
        break;
      case "part":
        sys.puts(nick + " part");
        break;
    }

    var room = sessions.fromnick(nick).room.id;
    //sys.puts("this is the roomsroom: " + rooms[room]);
    if (rooms[room] == undefined)  {
    	rooms[room] = { messages: [], callbacks: [] };
    }

    
    rooms[room].messages.push( m );
    //sys.puts("appendMessage for " + nick + " in room " + room);
    //sys.puts("--> room messages length: " + rooms[room].messages.length);
    

    while (rooms[room].callbacks.length > 0) {
      rooms[room].callbacks.shift().callback([m]);
    }

    while (rooms[room].messages.length > MESSAGE_BACKLOG)
      rooms[room].messages.shift();
  };

  this.query = function (session, since, callback) {
    var matching = [];
    var room = session.room.id;
    for (var i = 0; i < rooms[room].messages.length; i++) {
      var message = rooms[room].messages[i];
      if (message.timestamp > since)
        matching.push(message)
    }

    if (matching.length != 0) {
      callback(matching);
    } else {
      rooms[room].callbacks.push({ timestamp: new Date(), callback: callback });
    }
  };

  // clear old callbacks
  // they can hang around for at most 30 seconds.
  setInterval(function () {
    var now = new Date();
    for (var i in rooms) {
    	var callbacks = rooms[i].callbacks;	
    	while (callbacks.length > 0 && now - callbacks[0].timestamp > 30*1000) {
      		callbacks.shift().callback([]);
   		}
   	}
  }, 3000);
};

var rooms = {};
var sessions = {};

sessions.fromnick = function (nick) {
  for (var i in sessions) {
    var session = sessions[i];
    if (session && session.nick === nick) return session;
  }
}


function createSession (nick, room) {
  if (nick.length > 50) return null;
  if (/[^\w_\-^!]/.exec(nick)) return null;

  // bail out if that name is already here
  for (var i in sessions) {
    var session = sessions[i];
    if (session && session.nick === nick) return null;
  }
  
  var session = { 
    nick: nick, 
    id: Math.floor(Math.random()*99999999999).toString(),
    timestamp: new Date(),

    poke: function () {
      session.timestamp = new Date();
    },

    destroy: function () {
      channel.appendMessage(session.nick, "part");
      
      // TODO: this seems silly. we should just as the room to nuke its own reference
      // eremove the room's reference to the session
      delete rooms[session.room.id].sessions[session.id];
      delete sessions[session.id];
    }
  };

  sessions[session.id] = session;

  // if this session is already in a room, try to join it to the room
  var inRoom = false;
  for (var i in rooms) {
  	var globalroom = rooms[i];
  	if (globalroom && globalroom.id === room) {
  		// okay we have a room to join this session in to
  		globalroom.sessions[session.id] = session;
  		session.room = globalroom;
  		inRoom = true;
  		break;
  	}
  }
  
  // okay, not in a room? create one
  if (!inRoom) {
	  var newroom = {
  		id: Math.floor(Math.random()*99999999999).toString(),
  		timestamp: new Date(),
  		sessions: new Array(),
  		
  		//TODO: if there are no more sessions connected to a room, we need to destroy the room
  		// altho maybe this is automtically handled by the session being destroyed? tbd
  		destroy: function () {
  			delete rooms[newroom.id];
  		}
  	  };
  	  
  	  newroom.sessions[session.id] = session;
  	  //TODO: really shoudl clean up the interface on how sessions keep track of the room they're in
  	  session.room = newroom;
	  rooms[newroom.id] = newroom;
  }


  return session;
}

// interval to kill off old sessions
setInterval(function () {
  var now = new Date();
  for (var id in sessions) {
    if (!sessions.hasOwnProperty(id)) continue;
    var session = sessions[id];

    if (now - session.timestamp > SESSION_TIMEOUT) {
      session.destroy();
    }
  }
}, 1000);

// TODO: interval to dump out system stats
/*
setInterval(function () {
	sys.puts(dumpSystemStats());
}, 5000);
*/

function dumpSystemStats() {

	var now = new Date();
	var results = "";

	results += "at " + now + " the system reports:\n";

	//sys.puts(sessions.length);
	for (var id in rooms) {
		if (!rooms.hasOwnProperty(id)) continue;
		
		var room = rooms[id];
		
		results += "room: " + room.id + " " + room.timestamp + "\n";
		
		for (var sessionid in room.sessions) {
			if (!room.sessions.hasOwnProperty(sessionid)) continue;
			
			var session = room.sessions[sessionid];
			
			results += "\tsession: " + session.nick + " " + session.id;
		}
	}
	
	return results;
}

fu.listen(Number(process.env.PORT || PORT), HOST);

fu.get("/", fu.staticHandler("index.html"));
fu.get("/style.css", fu.staticHandler("style.css"));
fu.get("/client.js", fu.staticHandler("client.js"));
fu.get("/jquery-1.2.6.min.js", fu.staticHandler("jquery-1.2.6.min.js"));

fu.get("/status", function(req, res) {
	res.simpleJSON(200, {data: dumpSystemStats() , rss: mem.rss, starttime: starttime } );
	return;
});


fu.get("/who", function (req, res) {
  var id = qs.parse(url.parse(req.url).query).id;
  if (id == null) {
  	res.simpleJSON(400, {error: "Must provide an ID to query who"});
  	return;
  }
  
  // find the room this session is in
  var roomid = sessions[id].room.id;
  
  var nicks = [];
  for (var searchid in sessions) {
    if (!sessions.hasOwnProperty(searchid)) continue;
    var session = sessions[searchid];
    /*sys.puts("nick found: " + session.nick + " roomid = " + roomid);
    // only add the nicks that are in the room the client is in
    sys.puts ("session.room != undefined: " + (session.room != undefined));
    if (session.room != undefined) {
    	sys.puts ("session.room.id == roomid : " + (session.room.id == roomid));
    }*/
    
    if (session.room != undefined && session.room.id == roomid) continue;
    nicks.push(session.nick);
  }
  //sys.puts(nicks.length);
  res.simpleJSON(200, { nicks: nicks
                      , rss: mem.rss
                      });
});

fu.get("/join", function (req, res) {
  var nick = qs.parse(url.parse(req.url).query).nick;
  var room = qs.parse(url.parse(req.url).query).room;
  if (nick == null || nick.length == 0) {
    res.simpleJSON(400, {error: "Bad nick."});
    return;
  }
  var session = createSession(nick, room);
  if (session == null) {
    res.simpleJSON(400, {error: "Nick in use"});
    return;
  }

  sys.puts("connection: " + nick + "@" + res.connection.remoteAddress + " in room " + session.room.id);

  channel.appendMessage(session.nick, "join");
  res.simpleJSON(200, { id: session.id
                      , nick: session.nick
                      , url: "#room" + session.room.id
                      , rss: mem.rss
                      , starttime: starttime
                      });
});

fu.get("/part", function (req, res) {
  var id = qs.parse(url.parse(req.url).query).id;
  var session;
  if (id && sessions[id]) {
    session = sessions[id];
    session.destroy();
  }
  res.simpleJSON(200, { rss: mem.rss });
});

fu.get("/recv", function (req, res) {
  //sys.puts("recv " + req.url);


  if (!qs.parse(url.parse(req.url).query).since) {
    res.simpleJSON(400, { error: "Must supply since parameter" });
    return;
  }
  var id = qs.parse(url.parse(req.url).query).id;
  var session;
  if (id && sessions[id]) {
    session = sessions[id];
    session.poke();
  }
  else {
  	// it's possible a stale client gave us a stale id, e.g. after a server recycle
  	res.simpleJSON(400, { error: "Client ID was not valid" });
  	return;
  }
  
  var since = parseInt(qs.parse(url.parse(req.url).query).since, 10);

  channel.query(session, since, function (messages) {
    if (session) session.poke();
    res.simpleJSON(200, { messages: messages, rss: mem.rss });
  });
});

fu.get("/send", function (req, res) {
  var id = qs.parse(url.parse(req.url).query).id;
  var text = qs.parse(url.parse(req.url).query).text;

  var session = sessions[id];
  if (!session || !text) {
    res.simpleJSON(400, { error: "No such session id" });
    return;
  }

  session.poke();

  channel.appendMessage(session.nick, "msg", text);
  res.simpleJSON(200, { rss: mem.rss });
});

