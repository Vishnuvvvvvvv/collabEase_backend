const express = require("express");
const http = require("http");
const { v4: uuidv4 } = require("uuid");
const cors = require("cors");
const twilio = require("twilio");
const path = require("path");
const { AssemblyAI } = require("assemblyai");

const client = new AssemblyAI({
  apiKey: "694f60992656421a85b64ae955ae7374",
});

const PORT = process.env.PORT || 5002;
const app = express();
const server = http.createServer(app);

const multer = require("multer");
const axios = require("axios");
const fs = require("fs");
const upload = multer({ dest: "uploads/" });

app.use(cors());

let connectedUsers = [];
let rooms = [];
const roooms = {};
// Serve static files from the frontend build directory
// app.use(express.static(path.join(__dirname, '..', 'frontend', 'build')));

// // Route for serving the index.html file
// app.get('/', (req, res) => {
//   res.sendFile(path.join(__dirname, '..', 'frontend', 'build', 'index.html'));
// });
app.get("/", (req, res) => {
  res.send("helloo");
});
// create route to check if room exists
app.get("/api/room-exists/:roomId", (req, res) => {
  const { roomId } = req.params;
  const room = rooms.find((room) => room.id === roomId);

  if (room) {
    // send reponse that room exists
    if (room.connectedUsers.length > 3) {
      return res.send({ roomExists: true, full: true });
    } else {
      return res.send({ roomExists: true, full: false });
    }
  } else {
    // send response that room does not exists
    return res.send({ roomExists: false });
  }
});

app.get("/api/get-turn-credentials", (req, res) => {
  const accountSid = "AC7cff1792ce0f8d410f4790a5048eeeb7";
  const authToken = "c9f5e65fe22c2e6764d5ca5530d4970c";

  const client = twilio(accountSid, authToken);

  res.send({ token: null });
  try {
    client.tokens.create().then((token) => {
      res.send({ token });
    });
  } catch (err) {
    console.log("error occurred when fetching turn server credentials");
    console.log(err);
    res.send({ token: null });
  }
});

function generateSpeakerMapping(names) {
  // Remove duplicates while preserving order
  const uniqueNames = [...new Set(names)];

  // Create unique speaker tags
  const speakerTags = uniqueNames.map(
    (_, i) => `Speaker ${String.fromCharCode(65 + i)}`
  );

  // Create mapping from speaker tags to names
  const tagToName = {};
  speakerTags.forEach((tag, index) => {
    tagToName[tag] = uniqueNames[index];
  });

  return tagToName;
}

app.post(
  "/multi-transcribe",

  upload.single("audio_file"),
  async (req, res) => {
    console.log("getet");
    let firstValue;
    if (Object.keys(roooms).length > 0) {
      const firstKey = Object.keys(roooms)[0];
      firstValue = roooms[firstKey];
      console.log("active speaker arry : ", firstValue);
    } else {
      console.log("The object is empty.");
    }
    try {
      const filePath = req.file.path;

      // Send file to AssemblyAI for transcription
      const params = {
        audio: fs.createReadStream(filePath),
        speaker_labels: true,
      };

      console.log("sended..");
      const transcript = await client.transcripts.transcribe(params);
      console.log("trancript", transcript);
      let transcribedText = "";
      for (const utterance of transcript.utterances) {
        transcribedText +=
          `Speaker ${utterance.speaker}: ${utterance.text}` + "\n";
      }
      // Send back the transcription result

      console.log("transcribedText is ", transcribedText);

      let result = "";
      if (firstValue) {
        const tagToName = generateSpeakerMapping(firstValue);

        for (const [speaker, name] of Object.entries(tagToName)) {
          result += transcribedText.replace(new RegExp(speaker, "g"), name);
        }

        console.log("transcribedText speaker mapping is ", result);
      }
      res.status(200).json({
        transcript: result ? result : transcribedText,
      });
      // Clean up the uploaded file after transcription
      fs.unlinkSync(filePath);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to process transcription" });
    }
  }
);

const io = require("socket.io")(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});
const activeSpeakers = [];

io.on("connection", (socket) => {
  console.log(`user connected ${socket.id}`);

  //we need to get these informations from frontend

  // socket.on("activeSpeaker", ({ name }) => {
  //   const lastSpeaker = activeSpeakers[activeSpeakers.length - 1];
  //   if (name !== lastSpeaker) {
  //     activeSpeakers.push(name);
  //     console.log(`Speaker added: ${name}`);
  //     console.log("Current speaker order:", activeSpeakers);

  //     // Optional: Broadcast the updated speaker list
  //     io.emit("updateActiveSpeakers", activeSpeakers);
  //   }
  // });
  // Storage for rooms and their speakers
  console.log("Server started at", new Date(), roooms); // Log the start time
  socket.on("speaking", ({ roomId, name }) => {
    console.log(
      `Received speaking event: ${name} for room ${roomId} and speakers array is:`,
      roooms[roomId] || [] // Log the speakers for the room, or an empty array if the room doesn't exist yet
    );
    console.log("full room is:  ", roooms);

    // Initialize room's speakers if not already set
    if (!roooms[roomId]) {
      roooms[roomId] = [];
    }

    // Only add the speaker to the array if the last speaker is different from the current speaker
    if (
      roooms[roomId].length === 0 ||
      roooms[roomId][roooms[roomId].length - 1] !== name
    ) {
      roooms[roomId].push(name); // Only push if not the same as the last speaker
      console.log(
        `New speaker added for room ${roomId}. Updated speakers array:`,
        roooms[roomId]
      );
    } else {
      console.log(
        `${name} is the last speaker for room ${roomId}, not adding again.`
      );
    }
  });

  socket.on("create-new-room", (data) => {
    console.log("Create new room clicked !");
    createNewRoomHandler(data, socket);
  });

  socket.on("join-room", (data) => {
    joinRoomHandler(data, socket);
  });

  socket.on("disconnect", () => {
    disconnectHandler(socket);
  });

  socket.on("conn-signal", (data) => {
    signalingHandler(data, socket);
  });

  socket.on("conn-init", (data) => {
    initializeConnectionHandler(data, socket);
  });

  socket.on("direct-message", (data) => {
    directMessageHandler(data, socket);
  });
});

// socket.io handlers

const createNewRoomHandler = (data, socket) => {
  console.log("host is creating new room");
  console.log(data);
  const { identity, onlyAudio } = data;

  const roomId = uuidv4();

  // create new user
  const newUser = {
    identity,
    id: uuidv4(),
    socketId: socket.id,
    roomId,
    onlyAudio,
  };

  // push that user to connectedUsers
  connectedUsers = [...connectedUsers, newUser];

  //create new room
  const newRoom = {
    id: roomId,
    connectedUsers: [newUser],
  };
  // join socket.io room
  socket.join(roomId);

  rooms = [...rooms, newRoom];

  // emit to that client which created that room roomId
  socket.emit("room-id", { roomId });

  // emit an event to all users connected
  // to that room about new users which are right in this room
  socket.emit("room-update", { connectedUsers: newRoom.connectedUsers });
};

const joinRoomHandler = (data, socket) => {
  const { identity, roomId, onlyAudio } = data;
  console.log(`${identity} has joined the room`);
  const newUser = {
    identity,
    id: uuidv4(),
    socketId: socket.id,
    roomId,
    onlyAudio,
  };

  // join room as user which just is trying to join room passing room id
  const room = rooms.find((room) => room.id === roomId);
  if (!room) {
    console.error(
      `Room with an ID ${roomId} does not exist. Available rooms:`,
      rooms
    );
    socket.emit("room-error", { error: "Room not found." });
    return;
  }
  room.connectedUsers = [...room.connectedUsers, newUser];

  // join socket.io room
  socket.join(roomId);

  // add new user to connected users array
  connectedUsers = [...connectedUsers, newUser];

  // emit to all users which are already in this room to prepare peer connection
  room.connectedUsers.forEach((user) => {
    if (user.socketId !== socket.id) {
      const data = {
        connUserSocketId: socket.id,
      };
      //tell evryone in the room to prepare peer connection for webrtc
      io.to(user.socketId).emit("conn-prepare", data);
      console.log("emitting to ", user.identity);
    }
  });

  io.to(roomId).emit("room-update", { connectedUsers: room.connectedUsers });
};

const disconnectHandler = (socket) => {
  // find if user has been registered - if yes remove him from room and connected users array
  const user = connectedUsers.find((user) => user.socketId === socket.id);

  if (user) {
    // remove user from room in server
    const room = rooms.find((room) => room.id === user.roomId);

    room.connectedUsers = room.connectedUsers.filter(
      (user) => user.socketId !== socket.id
    );

    // leave socket io room
    socket.leave(user.roomId);

    // close the room if amount of the users which will stay in room will be 0
    if (room.connectedUsers.length > 0) {
      // emit to all users which are still in the room that user disconnected
      io.to(room.id).emit("user-disconnected", { socketId: socket.id });

      // emit an event to rest of the users which left in the toom new connectedUsers in room
      io.to(room.id).emit("room-update", {
        connectedUsers: room.connectedUsers,
      });
    } else {
      rooms = rooms.filter((r) => r.id !== room.id);
    }
  }
};

const signalingHandler = (data, socket) => {
  const { connUserSocketId, signal } = data;

  const signalingData = { signal, connUserSocketId: socket.id };
  io.to(connUserSocketId).emit("conn-signal", signalingData);
};

// information from clients which are already in room that They have preapred for incoming connection
const initializeConnectionHandler = (data, socket) => {
  const { connUserSocketId } = data;

  const initData = { connUserSocketId: socket.id };
  io.to(connUserSocketId).emit("conn-init", initData);
};

const directMessageHandler = (data, socket) => {
  if (
    connectedUsers.find(
      (connUser) => connUser.socketId === data.receiverSocketId
    )
  ) {
    const receiverData = {
      authorSocketId: socket.id,
      messageContent: data.messageContent,
      isAuthor: false,
      identity: data.identity,
    };
    socket.to(data.receiverSocketId).emit("direct-message", receiverData);

    const authorData = {
      receiverSocketId: data.receiverSocketId,
      messageContent: data.messageContent,
      isAuthor: true,
      identity: data.identity,
    };

    socket.emit("direct-message", authorData);
  }
};

server.listen(PORT, () => {
  console.log(`Server is listening on ${PORT}`);
});
