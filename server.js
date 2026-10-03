require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const mongoDb = require("mongodb");
const base64 = require("base-64");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const multer = require("multer");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const fs = require("fs");
const { v2: cloudinary } = require("cloudinary");
const axios = require("axios");
const supabase = require("./supabase_db.js");

const app = express();
const port = process.env.PORT || process.env.port || 8000;
const uri = process.env.MONGODB_DEEINDER;

// -------------------------------------------------------------------------------------------------------
// SERVER & SOCKET.IO SETUP
// -------------------------------------------------------------------------------------------------------
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: [
      "https://deeinder-frontend.vercel.app",
      "http://localhost:3000"
    ]
  }
});

io.on("connection", (socket) => {
  socket.on("join_room", (data) => {
    socket.join(data);
  });

  socket.on("send_message", (data) => {
    socket.to(data.room).emit("recieve_message", data);
  });

  socket.on("disconnect", () => {
    // console.log("User disconnected", socket.id);
  });
});

// -------------------------------------------------------------------------------------------------------
// CLOUDINARY & MULTER CONFIGURATION
// -------------------------------------------------------------------------------------------------------
cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.CLOUD_API_KEY,
  api_secret: process.env.CLOUD_API_SECRET
});

const upload = multer({ storage: multer.memoryStorage() });

// -------------------------------------------------------------------------------------------------------
// MIDDLEWARE CONFIGURATION
// -------------------------------------------------------------------------------------------------------
app.use("/uploads", express.static("uploads"));
app.use(cors());
app.use(express.json());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// -------------------------------------------------------------------------------------------------------
// DATABASE CONNECTIONS & AUTHENTICATION
// -------------------------------------------------------------------------------------------------------
let client, db;

async function connectToMongo() {
  client = new mongoDb.MongoClient(uri, {});
  await client.connect();
  db = client.db("Deeinder");
  console.log("Connected to mongodb");
}

async function basicAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Basic ")) {
      res
        .status(401)
        .json({ message: "Authorization header missing or invalid" });
      throw new Error("Authorization header missing or invalid");
    }

    const base64Credentials = authHeader.split(" ")[1];
    const credentials = base64.decode(base64Credentials).split(":");
    const email = credentials[0];
    const password = credentials[1];

    const { data: user, error } = await supabase
      .from("membersPersonalInfo")
      .select("*")
      .eq("email", email)
      .single();

    if (error || !user) {
      res.status(401).json({ message: "User not found" });
      throw new Error("User not found");
    }

    const decodedPassword = base64.decode(user.password);
    if (decodedPassword !== password) {
      res.status(401).json({ message: "Incorrect Password" });
      throw new Error("Incorrect Password");
    }

    req.user = user;
    res.status(200);
    next();
  } catch (e) {
    console.error("Error Basic Authorization", e);
  }
}

// -------------------------------------------------------------------------------------------------------
// 
// DAVID'S WORK & HELPER FUNCTIONS
//
// -------------------------------------------------------------------------------------------------------

// EXTERNAL FACE DETECTION AI - DAVID
async function verifyProfilePicture(fileBuffer) {
  try {
    const base64Image = fileBuffer.toString("base64");

    const formData = new URLSearchParams();
    formData.append("api_key", process.env.FACE_AI_KEY);
    formData.append("api_secret", process.env.FACE_AI_SECRET);
    formData.append("image_base64", base64Image);
    formData.append("return_attributes", "blur");

    const response = await axios.post("https://faceplusplus.com", formData, {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });

    if (!response.data.faces || response.data.faces.length === 0) {
      return {
        isValid: false,
        message:
          "Animated or non-real facial images are not allowed. Please upload a proper facial image.",
      };
    }

    return { isValid: true };
  } catch (err) {
    if (err.response && err.response.data) {
      console.error("Cloud Face AI Rejection Detail:", err.response.data);
    } else {
      console.error("Cloud Face AI communication network error:", err.message);
    }

    return {
      isValid: false,
      message: "Error validating your facial image profile picture.",
    };
  }
}

// updating number of likes when a user likes a members profile - DAVID
app.put("/likeProfile/:likerUsername/:memberUsername", async (req, res) => {
  try {
    const member = req.params.memberUsername;
    const liker = req.params.likerUsername;

    const { data: profile } = await supabase
      .from("membersProfile")
      .select("likes")
      .eq("username", member)
      .single();

    if (!profile) {
      return res.status(404).json({ message: "Profile not found" });
    }

    const updatedLikes = profile.likes || [];

    if (!updatedLikes.includes(liker)) {
      updatedLikes.push(liker);
    }

    const { error } = await supabase
      .from("membersProfile")
      .update({ likes: updatedLikes })
      .eq("username", member);

    if (!error) {
      res.status(200).json({ message: "Successfully updated" });
    } else {
      throw new Error("Could not update number of likes");
    }
  } catch (error) {
    console.error("Error liking profile", error);
    res.status(500).send({ message: "Internal server error" });
  }
});

// updating number of likes when a user dislikes a members profile - DAVID
app.put("/dislikeProfile/:likerUsername/:memberUsername", async (req, res) => {
  try {
    const member = req.params.memberUsername;
    const liker = req.params.likerUsername;

    const { data: profile } = await supabase
      .from("membersProfile")
      .select("likes")
      .eq("username", member)
      .single();

    if (!profile) {
      return res.status(404).json({ message: "Profile not found" });
    }

    const currentLikes = profile.likes || [];
    const updatedLikes = currentLikes.filter((item) => item !== liker);

    const { error } = await supabase
      .from("membersProfile")
      .update({ likes: updatedLikes })
      .eq("username", member);

    if (!error) {
      res.status(200).json({ message: "successfully disliked profile" });
    } else {
      throw new Error("Could not update number of likes");
    }
  } catch (error) {
    console.error("Error disliking profile", error);
    res.status(500).send({ message: "Internal server error" });
  }
});

// updating profile data when user wants to edit their profile - DAVID
app.put("/UpdatemembersPersonalInfo/:username", upload.single("pfp"), async (req, res) => {
  let status = 500;
  let message = "Internal server error";
  const invalid = (m) => {
    status = 400;
    message = m || "Invalid input";
  };
  try {
    const updates = req.body.updates ? JSON.parse(req.body.updates) : {};
    const username = req.params.username;

    if (updates.username && updates.username !== username) {
      const newUsername = updates.username;
      const { data: existingUser } = await supabase
        .from("membersPersonalInfo")
        .select("id")
        .eq("user_name", newUsername)
        .maybeSingle();

      if (existingUser) {
        invalid("Username already exists");
        throw new Error("Username already exists");
      }
    }

    let pfpUrl;
    if (req.file) {
      const b64 = req.file.buffer.toString("base64");
      const dataURI = `data:${req.file.mimetype};base64,${b64}`;
      const uploadRes = await cloudinary.uploader.upload(dataURI);
      pfpUrl = uploadRes.secure_url;
    }

    const personalUpdates = {};
    if (updates.fullName) personalUpdates.full_name = updates.fullName;
    if (updates.username) personalUpdates.user_name = updates.username;
    if (pfpUrl) personalUpdates.pfp_path = pfpUrl;

    if (Object.keys(personalUpdates).length > 0) {
      const { error: personalErr } = await supabase
        .from("membersPersonalInfo")
        .update(personalUpdates)
        .eq("user_name", username);
      if (personalErr) throw personalErr;
    }

    const profileUpdates = {};
    if (updates.relationshipIntent !== undefined) profileUpdates.relationship_intent = updates.relationshipIntent;
    if (updates.shortDescription !== undefined) profileUpdates.short_description = updates.shortDescription;
    if (updates.interests !== undefined) profileUpdates.interests = updates.interests;
    if (updates.aboutMe !== undefined) profileUpdates.about_me = updates.aboutMe;

    if (Object.keys(profileUpdates).length > 0) {
      const { error: profileErr } = await supabase
        .from("membersProfile")
        .update(profileUpdates)
        .eq("username", username);
      if (profileErr) throw profileErr;
    }

    res.status(200).json({ message: "Profile updated successfully" });
  } catch (error) {
    console.error("Error updating member info", error);
    res.status(status).json({ message });
  }
});

// Adding pictures - DAVID
app.put(
  "/addPictures/:username",
  upload.single("picture"),
  async (req, res) => {
    try {
      const b64 = req.file.buffer.toString("base64");
      const dataURI = `data:${req.file.mimetype};base64,${b64}`;
      const pfpPath = await cloudinary.uploader.upload(dataURI);

      const { data: profile } = await supabase
        .from("membersProfile")
        .select("pics_paths")
        .eq("username", req.params.username)
        .single();

      if (!profile) {
        return res.status(404).json({ message: "Profile not found" });
      }

      const updatedPics = profile.pics_paths || [];
      updatedPics.push(pfpPath.secure_url);

      const { error } = await supabase
        .from("membersProfile")
        .update({ pics_paths: updatedPics })
        .eq("username", req.params.username);

      if (!error) {
        res.status(200).json({ message: "successfully updated" });
      } else {
        throw new Error("couldn't add picture");
      }
    } catch (error) {
      console.error("Error adding new pictures", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Removing pictures - DAVID
app.put("/removePicture/:username", async (req, res) => {
  try {
    const path = req.body.path;

    const { data: profile } = await supabase
      .from("membersProfile")
      .select("pics_paths")
      .eq("username", req.params.username)
      .single();

    if (!profile) {
      return res.status(404).json({ message: "Profile not found" });
    }

    const currentPics = profile.pics_paths || [];
    const updatedPics = currentPics.filter((item) => item !== path);

    const { error } = await supabase
      .from("membersProfile")
      .update({ pics_paths: updatedPics })
      .eq("username", req.params.username);

    if (!error) {
      res.status(200).json({ message: "successfully removed picture" });
    } else {
      throw new Error("couldn't remove picture");
    }
  } catch (error) {
    console.error("Error removing picture", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// posting a new message - DAVID
app.post("/sendAMessage", async (req, res) => {
  try {
    const messagePayload = {
      sender_id: req.body.senderId,
      receiver_id: req.body.recieverId,
      message: req.body.content,
      room: req.body.room || null,
    };

    const { error } = await supabase.from("messages").insert([messagePayload]);

    if (error) throw error;

    res.status(200).json({ message: "successsfully sent" });
  } catch (error) {
    console.error("Error sending messages", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// getting messages recieved by a user - DAVID
app.get("/messages/:username", async (req, res) => {
  try {
    const username = req.params.username;

    const { data: result, error } = await supabase
      .from("messages")
      .select("*")
      .or(`receiver_id.eq.${username},sender_id.eq.${username}`);

    if (error) throw error;

    const mappedResult = result.map((msg) => ({
      id: msg.id,
      senderId: msg.sender_id,
      recieverId: msg.receiver_id,
      room: msg.room,
      content: msg.message,
      created_at: msg.created_at,
    }));

    res.json(mappedResult);
  } catch (error) {
    console.error("Error getting messages", error);
    res.status(500).send({ message: "Internal server error" });
  }
});


// -------------------------------------------------------------------------------------------------------
// 
// DANIELLA'S ENDPOINTS
//
// -------------------------------------------------------------------------------------------------------

// signing up - DANIELLA
app.post("/signUp", upload.single("pfp"), async (req, res) => {
  let status = 500;
  let message = "Internal server error";
  const invalid = (m) => {
    status = 400;
    message = m;
  };

  try {
    const memDetails = JSON.parse(req.body.details);
    let { fullName, username, email, password, confirmPassword, gender, dob } =
      memDetails;

    if (!req.file) {
      invalid("Please upload a profile picture");
      throw new Error("Please upload a profile picture");
    }

    // Call Face AI verification helper
    const faceCheck = await verifyProfilePicture(req.file.buffer);
    if (!faceCheck.isValid) {
      invalid(faceCheck.message);
      throw new Error(faceCheck.message);
    }

    const b64 = req.file.buffer.toString("base64");
    const dataURI = `data:${req.file.mimetype};base64,${b64}`;
    const pfpPath = await cloudinary.uploader.upload(dataURI);

    if (!email.includes("@")) {
      invalid("Invalid email");
      throw new Error("Invalid email");
    }

    const { data: isEmailExists, error: emailError } = await supabase
      .from("membersPersonalInfo")
      .select("id")
      .eq("email", email)
      .maybeSingle();
    if (emailError) throw emailError;

    if (isEmailExists) {
      invalid("Email already exists please log in");
      throw new Error("Email already exists please log in");
    }

    if (
      password.match(/\d/g) == null ||
      password.match(/\D/g) == null ||
      password.match(/([\W]|_)/g) == null
    ) {
      invalid("Password should include numbers and letters and symbols");
      throw new Error("Password should include numbers and letters and symbols");
    }

    if (password !== confirmPassword) {
      invalid("passwords do not match");
      throw new Error("passwords do not match");
    }

    const { data: isUsernameExists, error: usernameError } = await supabase
      .from("membersPersonalInfo")
      .select("id")
      .eq("user_name", username)
      .maybeSingle();
    if (usernameError) throw usernameError;

    if (isUsernameExists) {
      invalid("username already taken");
      throw new Error("username already taken");
    }

    const today = new Date();
    const minDate = new Date(
      today.getFullYear() - 18,
      today.getMonth(),
      today.getDate()
    );

    dob = new Date(dob);

    if (dob > minDate) {
      invalid("You need to be above 18 to use this website");
      throw new Error("You need to be above 18 to use this website");
    }

    let age = today.getFullYear() - dob.getFullYear();
    const monthDifference = today.getMonth() - dob.getMonth();
    if (
      monthDifference < 0 ||
      (monthDifference === 0 && today.getDate() < dob.getDate())
    ) {
      age--;
    }

    const encodedPassword = base64.encode(password);

    const { data: member, error: memberError } = await supabase
      .from("membersPersonalInfo")
      .insert({
        full_name: fullName,
        user_name: username,
        email: email,
        password: encodedPassword,
        gender: gender,
        dob: dob.toISOString().split("T")[0],
        age: age,
        pfp_path: pfpPath.secure_url,
        profile_status: true
      })
      .select()
      .single();
    if (memberError) throw memberError;

    const { error: profileError } = await supabase
      .from("membersProfile")
      .insert({
        user_id: member.id,
        username: username,
        relationship_intent: null,
        short_description: null,
        interests: [],
        about_me: {},
        likes: [],
        connections_count: 0,
        pics_paths: [],
        profile_status: true
      });
    if (profileError) throw profileError;

    res.status(200).json({
      message: "successfully signed up",
      email,
      username,
      gender,
      fullName
    });
  } catch (error) {
    console.error("Error signing user up", error);
    res.status(status).json({ error: message });
  }
});

// logging in - DANIELLA
app.post("/login", async (req, res) => {
  let status = 500;
  let message = "Internal server error";
  const invalid = (m) => {
    status = 400;
    message = m;
  };

  try {
    const { email, password } = req.body;

    if (!email || !password) {
      invalid("Please enter email and password");
      throw new Error("Please enter email and password");
    }

    const { data: user, error } = await supabase
      .from("membersPersonalInfo")
      .select("id, email, password, user_name, gender, full_name, age, pfp_path")
      .eq("email", email)
      .maybeSingle();
    if (error) throw error;

    if (!user) {
      invalid("Email does not exist, please sign up");
      throw new Error("Email does not exist, please sign up");
    }

    const decodedPassword = base64.decode(user.password);
    if (decodedPassword !== password) {
      invalid("Incorrect password");
      throw new Error("Incorrect password");
    }

    res.status(200).json({
      id: user.id,
      email: user.email,
      username: user.user_name,
      gender: user.gender,
      fullName: user.full_name,
      age: user.age,
      pfpPath: user.pfp_path
    });
  } catch (error) {
    console.error("Error logging user in", error);
    res.status(status).json({ error: message });
  }
});

// Upload profile picture endpoint - DANIELLA
app.post("/UploadPfp", upload.single("pfp"), async (req, res) => {
  res.status(200).json(req.file);
});

// getting all members profiles to display on home page - DANIELLA
app.get("/membersProfiles", async (req, res) => {
  try {
    const { data: profiles, error: profileErr } = await supabase
      .from("membersProfile")
      .select("*")
      .eq("profile_status", true);
    if (profileErr) throw profileErr;

    const { data: membersInfo, error: infoErr } = await supabase
      .from("membersPersonalInfo")
      .select("id, age, full_name, user_name, gender, pfp_path")
      .eq("profile_status", true);
    if (infoErr) throw infoErr;

    const members = membersInfo.map((info) => {
      const profile = profiles.find((p) => p.user_id === info.id) || {};
      return {
        age: info.age,
        fullName: info.full_name,
        username: info.user_name,
        gender: info.gender,
        pfpPath: info.pfp_path,
        relationshipIntent: profile.relationship_intent ?? null,
        shortDescription: profile.short_description ?? null,
        interests: profile.interests ?? [],
        aboutMe: profile.about_me ?? {},
        likes: profile.likes ?? [],
        connections: profile.connections_count ?? 0,
        picsPaths: profile.pics_paths ?? []
      };
    });

    res.status(200).json([...members]);
  } catch (error) {
    console.error("error getting all members", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// getting a single profile - DANIELLA
app.get("/memberProfile/:username", async (req, res) => {
  let status = 500;
  let message = "Internal server error";
  const invalid = () => {
    status = 400;
    message = "user does not exist";
  };

  try {
    const username = req.params.username;

    const { data: memberInfo, error: infoErr } = await supabase
      .from("membersPersonalInfo")
      .select("id, age, full_name, user_name, pfp_path")
      .eq("user_name", username)
      .maybeSingle();
    if (infoErr) throw infoErr;

    if (!memberInfo) {
      invalid();
      throw new Error("User does not exist");
    }

    const { data: profile, error: profileErr } = await supabase
      .from("membersProfile")
      .select("*")
      .eq("user_id", memberInfo.id)
      .maybeSingle();
    if (profileErr) throw profileErr;

    res.status(200).json({
      age: memberInfo.age,
      fullName: memberInfo.full_name,
      username: memberInfo.user_name,
      pfpPath: memberInfo.pfp_path,
      relationshipIntent: profile?.relationship_intent ?? null,
      shortDescription: profile?.short_description ?? null,
      interests: profile?.interests ?? [],
      aboutMe: profile?.about_me ?? {},
      likes: profile?.likes ?? [],
      connections: profile?.connections_count ?? 0,
      picsPaths: profile?.pics_paths ?? []
    });
  } catch (error) {
    console.error("Error getting profile", error);
    res.status(status).send({ message: message });
  }
});

// getting unread messages and count for a user - new messages indicator - DANIELLA
app.get("/messages/unread/:username", async (req, res) => {
  try {
    const username = req.params.username;

    const { data: unreadMessages, error } = await supabase
      .from("messages")
      .select("*")
      .eq("receiver_id", username)
      .eq("is_read", false)
      .order("created_at", { ascending: false });

    if (error) throw error;

    const mappedMessages = unreadMessages.map((msg) => ({
      id: msg.id,
      senderId: msg.sender_id,
      recieverId: msg.receiver_id,
      room: msg.room,
      content: msg.message,
      isRead: msg.is_read,
      created_at: msg.created_at
    }));

    const countBySender = {};
    for (const msg of mappedMessages) {
      countBySender[msg.senderId] = (countBySender[msg.senderId] || 0) + 1;
    }

    res.status(200).json({
      totalUnread: mappedMessages.length,
      countBySender,
      messages: mappedMessages
    });
  } catch (error) {
    console.error("Error getting unread messages", error);
    res.status(500).json({ message: "Internal server error" });
  }
});


// -------------------------------------------------------------------------------------------------------
// 
// NISSI'S ENDPOINTS
//
// -------------------------------------------------------------------------------------------------------

// creating a new connection request when someone sends it - NISSI
app.post(
  "/connectionRequest/:senderUsername/:recieverUsername",
  async (req, res) => {
    let status = 500;
    let message = "Internal server error";
    try {
      const senderUsername = req.params.senderUsername;
      const recieverUsername = req.params.recieverUsername;

      const { data: result, error } = await supabase
        .from("connection_requests")
        .insert([{
          receiver_username: recieverUsername,
          sender_username: senderUsername,
          date_sent: new Date(),
          has_accepted: false,
          date_accepted: null,
        }])
        .select();

      if (error) {
        console.error("Supabase Error Details:", error);
        return res.status(400).json({ message: error.message });
      }

      if (!error && result) {
        res.status(200).json({ message: "successfully sent request" });
      } else {
        throw new Error("could not send connection request");
      }
    } catch (error) {
      console.error("Error creating connection request", error);
      res.status(status).json({ message: message });
    }
  }
);

// getting all connection requests recieved by user - NISSI
app.get("/connectionRequests/:username", async (req, res) => {
  try {
    const username = req.params.username;

    const { data: result, error } = await supabase
      .from("connection_requests")
      .select("id, receiver_username, sender_username, has_accepted")
      .or(`receiver_username.eq.${username},sender_username.eq.${username}`);

    if (error) {
      console.error("Supabase Error:", error);
      return res.status(400).json({ message: error.message });
    }

    const formattedResult = result.map(reqItem => ({
      id: reqItem.id,
      recieverUsername: reqItem.receiver_username,
      senderUsername: reqItem.sender_username,
      hasAccepted: reqItem.has_accepted
    }));

    res.status(200).json(formattedResult);
  } catch (error) {
    console.error("Error getting connection requests", error);
    res.status(500).send({ message: "Internal server error" });
  }
});

// updating the hasAccepted and dataAccepted field when a user accepts a connection request - NISSI
app.put(
  "/acceptedConnectionRequest/:recieverUsername",
  async (req, res) => {
    try {
      const senderUsername = req.body.senderUsername;
      const recieverUsername = req.params.recieverUsername;

      console.log("Request Body:", req.body);
      console.log("Sender:", senderUsername, "| Receiver:", recieverUsername);

      const { data: result, error: updateErr } = await supabase
        .from("connection_requests")
        .update({ has_accepted: true, date_accepted: new Date() })
        .match({ sender_username: senderUsername, receiver_username: recieverUsername })
        .select();

      if (updateErr) console.error("Supabase Update Err:", updateErr);

      const { data: profiles, error: fetchErr } = await supabase
        .from("membersProfile")
        .select("username, connections_count")
        .or(`username.eq.${recieverUsername},username.eq.${senderUsername}`);

      if (fetchErr || updateErr || !profiles) {
        return res.status(400).json({ message: "Database query failed" });
      }

      let modifiedCount = 0;
      for (const profile of profiles) {
        const { error: incErr } = await supabase
          .from("membersProfile")
          .update({ connections_count: (profile.connections_count || 0) + 1 })
          .eq("username", profile.username);

        if (!incErr) modifiedCount++;
        else console.error(`--> Failed updating counter for ${profile.username}:`, incErr);
      }

      if (modifiedCount > 0 && result && result.length > 0) {
        const resData = result[0];
        res.status(200).json({
          id: resData.id,
          senderUsername: resData.sender_username,
          recieverUsername: resData.receiver_username,
          hasAccepted: resData.has_accepted,
          dateAccepted: resData.date_accepted
        });
      } else {
        return res.status(400).json({ message: "No matching connection request found to update" });
      }
    } catch (error) {
      console.error("Error accepting connection request", error);
      res.status(500).send({ message: "Internal server error" });
    }
  }
);

// when a user removes a member as a connection - NISSI
app.delete(
  "/removeConnectionRequest",
  async (req, res) => {
    try {
      const senderUsername = req.body.senderUsername;
      const recieverUsername = req.body.recieverUsername;

      const { data: deletedResult, error: delErr } = await supabase
        .from("connection_requests")
        .delete()
        .match({ sender_username: senderUsername, receiver_username: recieverUsername })
        .select();

      const { data: profiles, error: fetchErr } = await supabase
        .from("membersProfile")
        .select("username, connections_count")
        .or(`username.eq.${recieverUsername},username.eq.${senderUsername}`);

      if (delErr || fetchErr) throw new Error("Error removing connection");

      let modifiedCount = 0;
      for (const profile of profiles) {
        const { error: decErr } = await supabase
          .from("membersProfile")
          .update({ connections_count: Math.max((profile.connections_count || 0) - 1, 0) })
          .eq("username", profile.username);

        if (!decErr) modifiedCount++;
      }

      if (deletedResult && deletedResult.length > 0 && modifiedCount) {
        const delData = deletedResult[0];
        res.status(200).json({
          id: delData.id,
          senderUsername: delData.sender_username,
          recieverUsername: delData.receiver_username,
          hasAccepted: delData.has_accepted
        });
      } else {
        throw new Error("Error removing connection");
      }
    } catch (error) {
      console.error("Error removing connection request", error);
      res.status(500).send({ message: "Internal server error" });
    }
  }
);

// canceling a connection request - NISSI
app.delete(
  "/cancelConnectionRequest",
  async (req, res) => {
    try {
      const senderUsername = req.body.senderUsername;
      const recieverUsername = req.body.recieverUsername;

      const { data: deletedResult, error } = await supabase
        .from("connection_requests")
        .delete()
        .match({ sender_username: senderUsername, receiver_username: recieverUsername })
        .select();

      if (error) throw error;

      if (deletedResult && deletedResult.length > 0) {
        const delData = deletedResult[0];
        res.status(200).json({
          id: delData.id,
          senderUsername: delData.sender_username,
          recieverUsername: delData.receiver_username,
          hasAccepted: delData.has_accepted
        });
      } else {
        res.status(200).json({});
      }
    } catch (error) {
      console.error("Error cancelling connection request", error);
      res.status(500).send({ message: "Internal server error" });
    }
  }
);

// Notifications endpoints - NISSI
app.post("/notifications", async (req, res) => {
  try {
    const { receiver_username, sender_username, type, content } = req.body;

    const { data, error } = await supabase
      .from("notifications")
      .insert([{
        receiver_username,
        sender_username,
        type,
        content,
        is_read: false,
        created_at: new Date()
      }])
      .select();

    if (error) throw error;

    res.status(200).json({ message: "Notification created successfully", notification: data[0] });
  } catch (error) {
    console.error("Error creating notification", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

app.get("/notifications/:username", async (req, res) => {
  try {
    const username = req.params.username;

    const { data, error } = await supabase
      .from("notifications")
      .select("*")
      .eq("receiver_username", username)
      .order("created_at", { ascending: false });

    if (error) throw error;

    res.status(200).json(data);
  } catch (error) {
    console.error("Error fetching notifications", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

app.put("/notifications/read/:id", async (req, res) => {
  try {
    const notificationId = req.params.id;

    const { data, error } = await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("id", notificationId)
      .select();

    if (error) throw error;

    res.status(200).json({ message: "Notification marked as read", notification: data[0] });
  } catch (error) {
    console.error("Error updating notification", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

app.delete("/notifications/:id", async (req, res) => {
  try {
    const notificationId = req.params.id;

    const { data, error } = await supabase
      .from("notifications")
      .delete()
      .eq("id", notificationId)
      .select();

    if (error) throw error;

    res.status(200).json({ message: "Notification deleted successfully", notification: data[0] });
  } catch (error) {
    console.error("Error deleting notification", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// To verify that email exists before doing the password reset thing - NISSI
app.post("/check-email", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: "Please provide an email" });
    }

    const { data: user, error } = await supabase
      .from("membersPersonalInfo")
      .select("email, user_name")
      .eq("email", email)
      .maybeSingle();

    if (error) throw error;

    if (!user) {
      return res.status(404).json({ message: "Email does not exist" });
    }

    res.status(200).json({ message: "Email verified", username: user.user_name });
  } catch (error) {
    console.error("Error checking email for reset", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

app.post("/reset-password", async (req, res) => {
  try {
    const { email, newPassword, confirmPassword } = req.body;

    if (!email || !newPassword || !confirmPassword) {
      return res.status(400).json({ message: "All fields are required" });
    }

    if (
      newPassword.match(/\d/g) == null ||
      newPassword.match(/\D/g) == null ||
      newPassword.match(/([\W]|_)/g) == null
    ) {
      return res.status(400).json({ message: "Password should include numbers, letters, and symbols" });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({ message: "Passwords do not match" });
    }

    const encodedPassword = base64.encode(newPassword);

    const { data, error } = await supabase
      .from("membersPersonalInfo")
      .update({ password: encodedPassword })
      .eq("email", email)
      .select("id, email, user_name, gender, full_name, age, pfp_path")
      .single();

    if (error) throw error;

    res.status(200).json({
      message: "Password successfully reset",
      user: {
        id: data.id,
        email: data.email,
        username: data.user_name,
        gender: data.gender,
        fullName: data.full_name,
        age: data.age,
        pfpPath: data.pfp_path
      }
    });
  } catch (error) {
    console.error("Error resetting password", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// -------------------------------------------------------------------------------------------------------
// SERVER LISTENER
// -------------------------------------------------------------------------------------------------------
server.listen(port, async () => {
  console.log(`Server is running on http://localhost:${port}`);
  await connectToMongo();
});