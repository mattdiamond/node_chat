var CONFIG = { debug: false
             , nick: "#"   // set in onConnect
             , id: null    // set in onConnect
             , url: null
             , last_message_time: 1
             , focus: true //event listeners bound in onConnect
             , unread: 0 //updated in the message-processing loop
             };

var nicks = [];

var currPoll = null;

//  CUT  ///////////////////////////////////////////////////////////////////
/* This license and copyright apply to all code until the next "CUT"
http://github.com/jherdman/javascript-relative-time-helpers/

The MIT License

Copyright (c) 2009 James F. Herdman

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
of the Software, and to permit persons to whom the Software is furnished to do
so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.


 * Returns a description of this past date in relative terms.
 * Takes an optional parameter (default: 0) setting the threshold in ms which
 * is considered "Just now".
 *
 * Examples, where new Date().toString() == "Mon Nov 23 2009 17:36:51 GMT-0500 (EST)":
 *
 * new Date().toRelativeTime()
 * --> 'Just now'
 *
 * new Date("Nov 21, 2009").toRelativeTime()
 * --> '2 days ago'
 *
 * // One second ago
 * new Date("Nov 23 2009 17:36:50 GMT-0500 (EST)").toRelativeTime()
 * --> '1 second ago'
 *
 * // One second ago, now setting a now_threshold to 5 seconds
 * new Date("Nov 23 2009 17:36:50 GMT-0500 (EST)").toRelativeTime(5000)
 * --> 'Just now'
 *
 */
Date.prototype.toRelativeTime = function(now_threshold) {
  var delta = new Date() - this;

  now_threshold = parseInt(now_threshold, 10);

  if (isNaN(now_threshold)) {
    now_threshold = 0;
  }

  if (delta <= now_threshold) {
    return 'Just now';
  }

  var units = null;
  var conversions = {
    millisecond: 1, // ms    -> ms
    second: 1000,   // ms    -> sec
    minute: 60,     // sec   -> min
    hour:   60,     // min   -> hour
    day:    24,     // hour  -> day
    month:  30,     // day   -> month (roughly)
    year:   12      // month -> year
  };

  for (var key in conversions) {
    if (delta < conversions[key]) {
      break;
    } else {
      units = key; // keeps track of the selected key over the iteration
      delta = delta / conversions[key];
    }
  }

  // pluralize a unit when the difference is greater than 1.
  delta = Math.floor(delta);
  if (delta !== 1) { units += "s"; }
  return [delta, units].join(" ");
};

/*
 * Wraps up a common pattern used with this plugin whereby you take a String
 * representation of a Date, and want back a date object.
 */
Date.fromString = function(str) {
  return new Date(Date.parse(str));
};

//  CUT  ///////////////////////////////////////////////////////////////////



//updates the users link to reflect the number of active users
function updateUsersLink ( ) {
  var t = nicks.length.toString() + " user";
  if (nicks.length != 1) t += "s";
  $("#usersLink").text(t);
}

//handles another person joining chat
function userJoin(nick, timestamp, room) {
  //put it in the stream
  addMessage(nick, "joined", timestamp, room, "join");
  
  // create a new CSS class for him unless it's the logged in user
  // they get their own class elsewhere
  if(nick != CONFIG.nick) {
  	$("<style type='text/css'> ." + nick + "{ padding: 5px; border-radius: 10px; } </style>").appendTo("head");
  }
  
  //if we already know about this user, ignore it
  for (var i = 0; i < nicks.length; i++)
    if (nicks[i] == nick) return;
  //otherwise, add the user to the list
  nicks.push(nick);
  //update the UI
  updateUsersLink();
}

//handles someone leaving
function userPart(nick, timestamp, room) {
  //put it in the stream
  addMessage(nick, "left", timestamp, room, "part");
  //remove the user from the list
  for (var i = 0; i < nicks.length; i++) {
    if (nicks[i] == nick) {
      nicks.splice(i,1)
      break;
    }
  }
  //update the UI
  updateUsersLink();
}

// utility functions

util = {
  urlRE: /https?:\/\/([-\w\.]+)+(:\d+)?(\/([^\s]*(\?\S+)?)?)?/g, 

  //  html sanitizer 
  toStaticHTML: function(inputHtml) {
    inputHtml = inputHtml.toString();
    return inputHtml.replace(/&/g, "&amp;")
                    .replace(/</g, "&lt;")
                    .replace(/>/g, "&gt;");
  }, 

  //pads n with zeros on the left,
  //digits is minimum length of output
  //zeroPad(3, 5); returns "005"
  //zeroPad(2, 500); returns "500"
  zeroPad: function (digits, n) {
    n = n.toString();
    while (n.length < digits) 
      n = '0' + n;
    return n;
  },

  //it is almost 8 o'clock PM here
  //timeString(new Date); returns "19:49"
  timeString: function (date) {
    var minutes = date.getMinutes().toString();
    var hours = date.getHours().toString();
    return this.zeroPad(2, hours) + ":" + this.zeroPad(2, minutes);
  },

  //does the argument only contain whitespace?
  isBlank: function(text) {
    var blank = /^\s*$/;
    return (text.match(blank) !== null);
  }
};

//used to keep the most recent messages visible
function scrollDown (room) {
  var chatroom = $(".chat[data-name='"+room+"']");
  var logElem = $(".logContainer", chatroom)[0];
  logElem.scrollTop = logElem.scrollHeight;
  $(".entry", chatroom).focus();
}

//inserts an event into the stream for display
//the event may be a msg, join or part type
//from is the user, text is the body and time is the timestamp, defaulting to now
//_class is a css class to apply to the message, usefull for system events
function addMessage (from, text, time, room, _class) {
  if (text === null)
    return;

  if (time == null) {
    // if the time is null or undefined, use the current time.
    time = new Date();
  } else if ((time instanceof Date) === false) {
    // if it's a timestamp, interpret it
    time = new Date(time);
  }

  //every message you see is actually a table with 3 cols:
  //  the time,
  //  the person who caused the event,
  //  and the content
  var messageElement = $(document.createElement("tr"));

  messageElement.addClass("message");
  
  // add the styling for this specific user
  //messageElement.addClass(from);
  
  if (_class)
    messageElement.addClass(_class);

  // sanitize
  text = util.toStaticHTML(text);

  // If the current user said this, add a special css class
  var nick_re = new RegExp(CONFIG.nick);
  if (nick_re.exec(text))
    messageElement.addClass("personal");

  // replace URLs with links
  text = text.replace(util.urlRE, '<a target="_blank" href="$&">$&</a>');
  
  text = text.replace(/(#\w+)/g, '<a target="_blank" class="hashLink" href="/$1">$1</a>');
  
  // just get some unique-ish numbers for this user to assign the bubble a color
  var color = "";
  if (from == CONFIG.nick) {
  	color = "colorwheel0";
  }
  else {
  	var charcodes = 0;
  	for (var i = 0; i < from.length; i++) {
 		charcodes += from.charCodeAt(i);
  	}
  	color = "colorwheel" + ((charcodes % 10) + 1);
  }
  
  var content = '<td class="date">' + util.timeString(time) + '</td>'
              + '<td class="nick">' + util.toStaticHTML(from) + '</td>'
              + '<td class="msg-text"><span class="' + from + '">' + text  + '</span></td>'
              ;
  messageElement.html(content);

  //the log is the stream that we view
  $('.chat[data-name="'+room+'"]').find(".log tbody").append(messageElement);

  //always view the most recent message when it is added
  scrollDown(room);
}

function updateRSS () {
  var bytes = parseInt(rss);
  if (bytes) {
    var megabytes = bytes / (1024*1024);
    megabytes = Math.round(megabytes*10)/10;
    $("#rss").text(megabytes.toString());
  }
}

/*function updateUptime () {
  if (starttime) {
    $("#uptime").text(starttime.toRelativeTime());
  }
}*/

function updateJoinUrl () {
	if (CONFIG.url) {
		location.hash = CONFIG.url;
		var loc = window.location.toString();
		$("#joinurl").text(loc);
	}
}

function updateNick () {
	if (CONFIG.nick) {
		$("#nick").text(CONFIG.nick);
	}
}

var transmission_errors = 0;
var first_poll = true;


//process updates if we have any, request updates from the server,
// and call again with response. the last part is like recursion except the call
// is being made from the response handler, and not at some point during the
// function's execution.
function longPoll (data) {
  if (transmission_errors > 2) {
  	// TODO: if we failed to connect to the server, reset the room
  	// location.hash = "";
    showConnect();
    return;
  }

  if (data && data.rss) {
    rss = data.rss;
    updateRSS();
  }

  //process any updates we may have
  //data will be null on the first call of longPoll
  if (data && data.messages) {
  	console.log(data);
    for (var i = 0; i < data.messages.length; i++) {
      var message = data.messages[i];

      //track oldest message so we only request newer messages from server
      if (message.timestamp > CONFIG.last_message_time)
        CONFIG.last_message_time = message.timestamp;

      //dispatch new messages to their appropriate handlers
      switch (message.type) {
        case "msg":
          if(!CONFIG.focus){
            CONFIG.unread++;
          }
          addMessage(message.nick, unescape(message.text), message.timestamp, message.room);
          break;

        case "join":
          userJoin(message.nick, message.timestamp, message.room);
          break;

        case "part":
          userPart(message.nick, message.timestamp, message.room);
          break;
      }
    }
    //update the document title to include unread message count if blurred
    updateTitle();

    //only after the first request for messages do we want to show who is here
    if (first_poll) {
      first_poll = false;
      who();
    }
  }

  //make another request
  currPoll = $.ajax({ cache: false
         , type: "GET"
         , url: "/recv"
         , dataType: "json"
         , data: { since: CONFIG.last_message_time, id: CONFIG.id }
         , error: function () {
             //addMessage("", "long poll error. trying again...", new Date(), "main", "error");
             //transmission_errors += 1;
             //don't flood the servers on error, wait 10 seconds before retrying
             //setTimeout(longPoll, 10*1000);
           }
         , success: function (data) {
             transmission_errors = 0;
             //if everything went well, begin another request immediately
             //the server will take a long time to respond
             //how long? well, it will wait until there is another message
             //and then it will return it to us and close the connection.
             //since the connection is closed when we get data, we longPoll again
             longPoll(data);
           }
         });
}

//submit a new message to the server
function send(msg, room) {
  if (CONFIG.debug === false) {
    // XXX should be POST
    // XXX should add to messages immediately
    jQuery.get("/send", {id: CONFIG.id, text: escape(msg), room: room}, function (data) { }, "json");
  }
}

//Transition the page to the state that prompts the user for a nickname
function showConnect () {
  $("#connect").show();
  $("#loading").hide();
  $("#toolbar").hide();
  $("#nickInput").focus();
  
  // show the correct instructions
  var inRoom = (location.hash.length > 0 ) ? true : false;
  if (inRoom) {
  	text = "You are joining an existing room. Enter your name to join.";
  	// one day, when i get who to work, this will populate the number of users in the room
  	/*
  	var room = location.hash.replace("#room", "");
  	jQuery.get("/who", {roomid : room}, function (data, status) {
		if (status != "success") return;
    	nicks = data.nicks;
    	alert(nicks);
    	$("#instructions").text("You are joining an existing room with " + nicks.length + " members. Enter you name to join.");
  	}, "json");
  	*/
  } else {
  	text = "To start a new chat room enter your name below.";
  }
  
  $("#instructions").text(text);
}

//transition the page to the loading screen
function showLoad () {
  $("#connect").hide();
  $("#loading").show();
  $("#toolbar").hide();
}

//transition the page to the main chat view, putting the cursor in the textfield
function showChat (nick) {
  $("#toolbar").show();
  $(".entry").focus();

  $("#connect").hide();
  $("#loading").hide();

  var room = $(".root.chat").attr('data-name');
  scrollDown(room);
}

//we want to show a count of unread messages when the window does not have focus
function updateTitle(){
  if (CONFIG.unread) {
    document.title = "(" + CONFIG.unread.toString() + ") quick group chat";
  } else {
    document.title = "quick group chat";
  }
}

// daemon start time
var starttime;
// daemon memory usage
var rss;

//handle the server's response to our nickname and join request
function onConnect (session) {
  if (session.error) {
    alert("error connecting: " + session.error);
    showConnect();
    return;
  }

  CONFIG.nick = session.nick;
  CONFIG.id   = session.id;
  CONFIG.url  = session.url;
  starttime   = new Date(session.starttime);
  rss         = session.rss;
  updateRSS();
  //updateUptime();
  updateJoinUrl();
  updateNick();

  //update the UI to show the chat
  showChat(CONFIG.nick);

  //listen for browser events so we know to update the document title
  $(window).bind("blur", function() {
    CONFIG.focus = false;
    updateTitle();
  });

  $(window).bind("focus", function() {
    CONFIG.focus = true;
    CONFIG.unread = 0;
    updateTitle();
  });
  
  // create a style for the user
  //$("<style type='text/css'> ." + session.nick + " { padding: 2px; border-radius: 2px; } </style>").appendTo("head");

  
  // begin polling the server
  // TODO: moved here from the ready
  longPoll();
}

//add a list of present chat members to the stream
function outputUsers () {
  var nick_string = nicks.length > 0 ? nicks.join(", ") : "(none)";
  if (nick_string.length == 0) nick_string = nicks[0];
  // TODO: figure out why this gets stuck
  //addMessage("users:", nick_string, new Date(), "notice");
  return false;
}

//get a list of the users presently in the room, and add it to the stream
function who () {
  jQuery.get("/who", {id : CONFIG.id}, function (data, status) {
    if (status != "success") return;
    nicks = data.nicks;
    outputUsers();
  }, "json");
}

$(document).ready(function() {

  //submit new messages when the user hits enter if the message isnt blank
  $(".entry").live('keypress', function (e) {
    if (e.keyCode != 13 /* Return */) return;
    var msg = $(this).val().replace("\n", "");
    var room = $(this).closest('.chat').attr('data-name');
    if (!util.isBlank(msg)) send(msg, room);
    $(this).val(''); // clear the entry field.
    
    //auto-generate chat rooms for each hash you enter
    var hashes = msg.match(/#\w+/g);
  	if (hashes){
  		$.each(hashes, function(i, val){
  			var room = val.substring(1);
  			spawnRoom(room);
  		});
  	}
  });

  $("#usersLink").click(outputUsers);

  //try joining the chat when the user clicks the connect button
  $("#connectButton").click(function () {
    //lock the UI while waiting for a response
    showLoad();
    var nick = $("#nickInput").attr("value");

    //dont bother the backend if we fail easy validations
    if (nick.length > 50) {
      alert("Nick too long. 50 character max.");
      showConnect();
      return false;
    }

    //more validations
    if (/[^\w_\-^!]/.exec(nick)) {
      alert("Bad character in nick. Can only have letters, numbers, and '_', '-', '^', '!'");
      showConnect();
      return false;
    }
    
    var room = (location.hash == '') ? "main" : location.hash.replace("#", "");
    
    //make the actual join request to the server
    $.ajax({ cache: false
           , type: "GET" // XXX should be POST
           , dataType: "json"
           , url: "/join"
           , data: { nick: nick, room: room }
           , error: function (data) {
               alert("error connecting to server " + data.error);
               showConnect();
             }
           , success: onConnect
           });
    return false;
  });

  // update the daemon uptime every 10 seconds
  /*setInterval(function () {
    updateUptime();
  }, 10*1000);*/

  if (CONFIG.debug) {
    $("#loading").hide();
    $("#connect").hide();
    scrollDown();
    return;
  }

  // remove fixtures
  $(".log table").remove();

  //begin listening for updates right away
  //interestingly, we don't need to join a room to get its updates
  //we just don't show the chat stream to the user until we create a session
  // TODO: moving this to onConnect. Does this make sense?
  // for the new design, we want to have a session before we poll the server
  //longPoll();

  showConnect();
  
  $(".hashLink").live('click', function(){
  	var name = $(this).text().substring(1);
  	//alert(name);
  	spawnRoom(name);
  	return false;
  });
  
  $(".chatWindow").live('mousedown', function(){
  	$(".chatWindow").not(this).removeClass('top');
  	$(this).addClass('top');
  });
});

//if we can, notify the server that we're going away.
$(window).unload(function () {
  jQuery.get("/part", {id: CONFIG.id}, function (data) { }, "json");
});

$(window).resize(function() {
	var root = $('.root.chat');
	if (root.length){
		var room = root.attr('data-name');
		scrollDown(room);
	}
});

function spawnRoom(name){
	$.getJSON('/joinRoom', {id: CONFIG.id, room: name }, function(response){
		if (response.result == 'success'){
			var chatWindow = $(".chatWindow.template").clone().removeClass('template');
			$('.chat', chatWindow).attr('data-name', name);
			$(".title", chatWindow).text('#'+name);
			$(".chatWindow").removeClass('top');
			chatWindow.addClass('top');
			chatWindow.appendTo("body").draggable().resizable();
			chatWindow.show('fold', 250, function(){
				$('.entry', this).focus();
			});
			currPoll.abort();
			longPoll(); // need to restart long polling with new room config
		}
	});
}