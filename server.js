require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const mongoDb = require("mongodb");
const app = express();
const base64 = require("base-64");
const port = process.env.port || 8000;
const uri = process.env.MONGODB_DEEINDER;
const cors = require("cors");
const supabase = require("./supabase_db.js");

const http = require("http");
const { Server } = require("socket.io");
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "https://deeinder-frontend.vercel.app",
  },
});

io.on("connection", (socket) => {
  socket.on("join_room", (data) => {
    socket.join(data);
  });

  socket.on("send_message", (data) => {
    socket.to(data.room).emit("recieve_message", data);
  });

  socket.on("disconnect", () => {
    // console.log("User disconnected",socket.id)
  });
});

const multer = require("multer");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const fs = require("fs");
const { send } = require("process");
const { v2: cloudinary } = require("cloudinary");
const { error } = require("console");

cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.CLOUD_API_KEY,
  api_secret: process.env.CLOUD_API_SECRET,
});
const upload = multer({ storage: multer.memoryStorage() });
app.use("/uploads", express.static("uploads"));

app.use(cors());
app.use(express.json());

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
      throw Error("Authorization header missing or invalid");
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

//signing up - DANIELLA
app.post("/signUp", upload.single("pfp"), async (req, res) => {
  let status = 500;
  let message = "Internal server error";
  const invalid = (m) => {
    status = 400;
    message = m;
  };
  try {
    const memDetails = JSON.parse(req.body.details);
    const membersInfoCol = db.collection("membersPersonalInfo");
    let { fullName, username, email, password, confirmPassword, gender, dob } =
      memDetails;

    if (!req.file) {
      invalid("Please upload a profile picture");
      throw new Error("Please upload a profile picture");
    }
    const b64 = req.file.buffer.toString("base64");
    const dataURI = `data:${req.file.mimetype};base64,${b64}`;
    const pfpPath = await cloudinary.uploader.upload(dataURI);

    if (!email.indexOf("@")) {
      invalid("Invalid email");
      throw new Error("Invalid email");
    }

    const isEmailExists = await membersInfoCol.findOne({ email });

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
      throw new Error(
        "Password should include numbers and letters and symbols",
      );
    }

    if (password !== confirmPassword) {
      invalid("passwords do not match");
      throw new Error("passwords do not match");
    }

    const isUsernameExists = await membersInfoCol.findOne({ username });

    if (isUsernameExists) {
      invalid("username already taken");
      throw new Error("username already taken");
    }

    let today = new Date();
    let minDate = new Date(today.setFullYear(today.getFullYear() - 18));

    dob = new Date(dob);
    if (dob > minDate) {
      invalid("You need to be above 18 to use this wesbite");
      throw new Error("You need to be above 18 to use this site");
    }

    delete memDetails.confirmPassword;
    memDetails.password = base64.encode(password);
    memDetails.dob = dob;
    today = new Date();
    let age = today.getFullYear() - dob.getFullYear();
    age = dob.setFullYear(today.getFullYear()) > today ? age - 1 : age;

    const result = await membersInfoCol.insertOne({
      ...memDetails,
      age,
      pfpPath: pfpPath.secure_url,
      profileStatus: true,
    });

    const result2 = await db.collection("membersProfile").insertOne({
      memberId: result["insertedId"],
      username,
      relationshipIntent: null,
      shortDescription: null,
      interests: [],
      aboutMe: {},
      likes: [],
      connections: 0,
      picsPaths: [],
      profileStatus: true,
    });
    res.status(200).json({
      message: "successfully signed up",
      email,
      password,
      username,
      gender,
      fullName,
    });
  } catch (error) {
    console.error("Error signing user up", error);
    res.status(status).send({ error: message });
  }
});

//logging in (checking password and email) - DANIELLA
app.post("/login", async (req, res) => {
  let status = 500;
  let message = "Internal server error";
  const invalid = (m) => {
    status = 400;
    message = m;
  };

  try {
    const membersCol = db.collection("membersPersonalInfo");
    const email = req.body.email;
    const password = req.body.password;

    if (!email || !password) {
      invalid("Please enter email and password");
      throw new Error("Please enter email and password");
    }

    const user = await membersCol.findOne(
      { email },
      {
        projection: {
          email: 1,
          password: 1,
          username: 1,
          gender: 1,
          fullName: 1,
        },
      },
    );
    if (!user) {
      invalid("Email does not exist, please sign up");
      throw new Error("Email does not exist, please sign up");
    }

    const decodedPassword = base64.decode(user.password);
    if (decodedPassword !== password) {
      invalid("Incorrect password");
      throw new Error("Incorrect password");
    }
    res.status(200).json({ ...user });
  } catch (error) {
    console.error("Error logging user in", error);
    res.status(status).json({ error: message });
  }
});

app.use(basicAuth);
app.post("/UploadPfp", upload.single("pfp"), async (req, res) => {
  res.status(200).json(req.file);
});

//getting all members profiles to display on home page - DANIELLA
app.get("/membersProfiles", async (req, res) => {
  try {
    const memProfilesCol = db.collection("membersProfile");
    const membersInfoCol = db.collection("membersPersonalInfo");

    const profiles = await memProfilesCol
      .find({ profileStatus: true }, { projection: { _id: 0, username: 0 } })
      .toArray();
    const membersInfo = await membersInfoCol
      .find(
        { profileStatus: true },
        {
          projection: {
            age: 1,
            fullName: 1,
            username: 1,
            gender: 1,
            pfpPath: 1,
          },
        },
      )
      .toArray();

    let members = [];
    for (let i = 0; i < membersInfo.length; i++) {
      members.push({ ...membersInfo[i], ...profiles[i] });
    }
    res.status(200).json([...members]);
  } catch (error) {
    console.error("error getting all members", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

//getiing a single profile - DANIELLA
app.get("/memberProfile/:username", async (req, res) => {
  let status = 500;
  let message = "Internal server error";
  const invalid = () => {
    status = 400;
    message = "user does not exist";
  };

  try {
    const memProfilesCol = db.collection("membersProfile");
    const membersInfoCol = db.collection("membersPersonalInfo");
    const username = req.params.username;

    const profile = await memProfilesCol.findOne({ username }, {});
    const memberInfo = await membersInfoCol.findOne(
      { username },
      { projection: { age: 1, fullName: 1, username: 1, pfpPath: 1 } },
    );

    let member = { ...memberInfo, ...profile };
    if (memberInfo) {
      res.status(200).json({ ...member });
    } else {
      invalid();
      throw new Error("User does not exist");
    }
  } catch (error) {
    console.error("Error getting profile", error);
    res.status(status).send({ message: message });
  }
});

//creating a new connection request when someone sends it - NISSI
app.post(
  "/connectionRequest/:senderUsername/:recieverUsername",
  async (req, res) => {
    let status = 500;
    let message = "Internal server error";
    const invalid = () => {
      status = 400;
      message = "user does not exist";
    };
    try {
      const senderUsername = req.params.senderUsername;
      const recieverUsername = req.params.recieverUsername;

      const { data: result, error } = await supabase
        .from("connection_requests")
        .insert([
          {
            receiver_username: recieverUsername,
            sender_username: senderUsername,
            date_sent: new Date(),
            has_accepted: false,
            date_accepted: null,
          },
        ])
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
  },
);
//updating number of likes when a user likes a members profile - DAVID
app.put("/likeProfile/:likerUsername/:memberUsername", async (req, res) => {
  try {
    const member = req.params.memberUsername;
    const liker = req.params.likerUsername;

    // 1. Fetch the profile row from Supabase
    const { data: profile } = await supabase
      .from("membersProfile")
      .select("likes")
      .eq("username", member)
      .single();

    // FIXED: Prevent "Cannot read properties of null" crash if profile name doesn't exist
    if (!profile) {
      return res.status(404).json({ message: "Profile not found" });
    }

    // UPDATED FOR TEXT ARRAY: Grab array data directly. Fall back to clean array if null.
    const updatedLikes = profile.likes || [];

    // Prevent duplicate entries in your array if the user double-clicks like
    if (!updatedLikes.includes(liker)) {
      updatedLikes.push(liker);
    }

    // 3. Update the row back in Supabase (saving as a true array object payload)
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

//     const result = await memProfilesCol.updateOne(
//       { username: member },
//       { $push: { likes: liker } }
//     );
//     console.log("hehe ")

//     if (result.modifiedCount === 1) {
//       res.status(200).json({ message: "Successfully updated" });
//     } else {
//       throw new Error("Could not update number of likes");
//     }
//   } catch (error) {
//     console.error("Error liking profile", error);
//     res.status(500).send({ message: "Internal server error" });
//   }
// });

//updating number of likes when a user dislikes a members profile - DAVID
app.put("/dislikeProfile/:likerUsername/:memberUsername", async (req, res) => {
  try {
    const member = req.params.memberUsername;
    const liker = req.params.likerUsername;

    // 1. Fetch the profile row from Supabase
    const { data: profile } = await supabase
      .from("membersProfile")
      .select("likes")
      .eq("username", member)
      .single();

    // FIXED: Prevent crash if profile name doesn't exist
    if (!profile) {
      return res.status(404).json({ message: "Profile not found" });
    }

    // UPDATED FOR TEXT ARRAY: Read directly as array structure
    const currentLikes = profile.likes || [];
    const updatedLikes = currentLikes.filter((item) => item !== liker);

    // 3. Update the row back in Supabase
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

//     const result = await memProfilesCol.updateOne(
//       { username: member },
//       { $pull: { likes: liker } }
//     );

//     if (result.modifiedCount === 1) {
//       res.status(200).json({ message: "successfully liked profile" });
//     } else {
//       throw new Error("Could not update number of likes");
//     }
//   } catch (error) {
//     console.error("Error disliking profile", error);
//     res.status(500).send({ mesNsage: "Internal server error" });
//   }
// });

//updating profile data when user wants to edit thier profile - DANIELLA
app.put(
  "/UpdatemembersPersonalInfo/:username",
  upload.single("pfp"),
  async (req, res) => {
    let status = 500;
    let message = "Internal server error";
    const invalid = () => {
      status = 400;
      message = "Invalid input";
    };
    try {
      const updates = JSON.parse(req.body.updates);
      const username = req.params.username;

      if (updates.username && updates.username !== username) {
        const newUsername = updates.username;
        if (
          await db
            .collection("membersProfile")
            .findOne({ username: newUsername })
        ) {
          invalid();
          throw new Error("Username already exists");
        }
      }

      if (req.file) {
        const b64 = req.file.buffer.toString("base64");
        const dataURI = `data:${req.file.mimetype};base64,${b64}`;
        const pfpPath = await cloudinary.uploader.upload(dataURI);

        const newPfpResult = await db
          .collection("membersPersonalInfo")
          .updateOne({ username }, { $set: { pfpPath: pfpPath.secure_url } });
        if (!newPfpResult.modifiedCount) {
          throw new Error("Could not update profile pic");
        }
      }

      const result = await db
        .collection("membersProfile")
        .updateOne({ username }, { $set: updates });

      if (updates.username && updates.username !== username) {
        const usernameResult = await db
          .collection("membersPersonalInfo")
          .updateOne({ username }, { $set: { username: updates.username } });
        if (!usernameResult.modifiedCount) {
          throw new Error("could not update username");
        }
      }

      res.status(200).json({ message: "successfully updated" });
    } catch (error) {
      console.error("Error updating profile", error);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// Adding pictures - DAVID
app.put(
  "/addPictures/:username",
  upload.single("picture"),
  async (req, res) => {
    try {
      const b64 = req.file.buffer.toString("base64");
      const dataURI = `data:${req.file.mimetype};base64,${b64}`;
      const pfpPath = await cloudinary.uploader.upload(dataURI);

      // 1. Fetch the profile row from Supabase
      const { data: profile } = await supabase
        .from("membersProfile")
        .select("pics_paths") // UPDATED: Match your schema's pics_paths column
        .eq("username", req.params.username)
        .single();

      if (!profile) {
        return res.status(404).json({ message: "Profile not found" });
      }

      // 2. Push the new Cloudinary URL into the array
      const updatedPics = profile.pics_paths || []; // UPDATED: Match your column name
      updatedPics.push(pfpPath.secure_url);

      // 3. Update the row back in Supabase
      const { error } = await supabase
        .from("membersProfile")
        .update({ pics_paths: updatedPics }) // UPDATED: Match your column name
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
  },
);

//   const result = await db.collection("membersProfile").updateOne({username:req.params.username},{$push:{picsPaths: pfpPath.secure_url}})
//   if(result.modifiedCount){
//     res.status(200).json({message:"successfully updated"})
//   }else{
//     throw new Error("couldn't add picture")
//   }
// }catch(error){
// console.error("Error adding new pictures", error);
// res.status(500).json({ error: "Internal server error" });
// }
// })

// Removing pictures - DAVID
app.put("/removePicture/:username", async (req, res) => {
  try {
    const path = req.body.path;

    // 1. Fetch the profile row from Supabase
    const { data: profile } = await supabase
      .from("membersProfile")
      .select("pics_paths") // UPDATED: Match your schema's pics_paths column
      .eq("username", req.params.username)
      .single();

    if (!profile) {
      return res.status(404).json({ message: "Profile not found" });
    }

    // 2. Filter out (pull) the specific image path from the array
    const currentPics = profile.pics_paths || []; // UPDATED: Match your column name
    const updatedPics = currentPics.filter((item) => item !== path);

    // 3. Update the row back in Supabase
    const { error } = await supabase
      .from("membersProfile")
      .update({ pics_paths: updatedPics }) // UPDATED: Match your column name
      .eq("username", req.params.username);

    if (!error) {
      res.status(200).json({ message: "successfully removed picture" });
    } else {
      throw new Error("couldn't remove picture");
    }
  } catch (error) {
    console.error("Error adding new pictures", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

//   if(result.modifiedCount){
//     res.status(200).json({message:"successfully updated"})
//   }else{
//     throw new Error("couldn't remove picture")
//   }

// }catch(error){
// console.error("Error adding new pictures", error);
// res.status(500).json({ error: "Internal server error" });
// }
// })

//getting all connection requests recieved by user - NISSI
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

    const formattedResult = result.map((reqItem) => ({
      id: reqItem.id,
      recieverUsername: reqItem.receiver_username,
      senderUsername: reqItem.sender_username,
      hasAccepted: reqItem.has_accepted,
    }));

    res.status(200).json(formattedResult);
  } catch (error) {
    console.error("Error getting connection requests", error);
    res.status(500).send({ message: "Internal server error" });
  }
});

//updating the hasAccepted and dataAccepted field when a user accepts a connection request - NISSI
app.put("/acceptedConnectionRequest/:recieverUsername", async (req, res) => {
  try {
    const senderUsername = req.body.senderUsername;
    const recieverUsername = req.params.recieverUsername;

    console.log("Request Body:", req.body);
    console.log("Sender:", senderUsername, "| Receiver:", recieverUsername);

    const { data: result, error: updateErr } = await supabase
      .from("connection_requests")
      .update({ has_accepted: true, date_accepted: new Date() })
      .match({
        sender_username: senderUsername,
        receiver_username: recieverUsername,
      })
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
      else
        console.error(
          `--> Failed updating counter for ${profile.username}:`,
          incErr,
        );
    }

    if (modifiedCount > 0 && result && result.length > 0) {
      const resData = result[0];
      res.status(200).json({
        id: resData.id,
        senderUsername: resData.sender_username,
        recieverUsername: resData.receiver_username,
        hasAccepted: resData.has_accepted,
        dateAccepted: resData.date_accepted,
      });
    } else {
      return res
        .status(400)
        .json({ message: "No matching connection request found to update" });
    }
  } catch (error) {
    console.error("Error accepting connection request", error);
    res.status(500).send({ message: "Internal server error" });
  }
});

//when a user removes a member as a connection - NISSI
app.delete("/removeConnectionRequest", async (req, res) => {
  try {
    const senderUsername = req.body.senderUsername;
    const recieverUsername = req.body.recieverUsername;
    console.log(req.body);

    const { data: deletedResult, error: delErr } = await supabase
      .from("connection_requests")
      .delete()
      .match({
        sender_username: senderUsername,
        receiver_username: recieverUsername,
      })
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
        .update({
          connections_count: Math.max((profile.connections_count || 0) - 1, 0),
        })
        .eq("username", profile.username);

      if (!decErr) modifiedCount++;
    }

    if (deletedResult && deletedResult.length > 0 && modifiedCount) {
      const delData = deletedResult[0];
      res.status(200).json({
        id: delData.id,
        senderUsername: delData.sender_username,
        recieverUsername: delData.receiver_username,
        hasAccepted: delData.has_accepted,
      });
    } else {
      throw new Error("Error removing connection");
    }
  } catch (error) {
    console.error("Error removing connection request", error);
    res.status(500).send({ message: "Internal server error" });
  }
});

//canceling a connection request - NISSI
app.delete("/cancelConnectionRequest", async (req, res) => {
  try {
    const senderUsername = req.body.senderUsername;
    const recieverUsername = req.body.recieverUsername;

    const { data: deletedResult, error } = await supabase
      .from("connection_requests")
      .delete()
      .match({
        sender_username: senderUsername,
        receiver_username: recieverUsername,
      })
      .select();

    if (error) throw error;

    if (deletedResult && deletedResult.length > 0) {
      const delData = deletedResult[0];
      res.status(200).json({
        id: delData.id,
        senderUsername: delData.sender_username,
        recieverUsername: delData.receiver_username,
        hasAccepted: delData.has_accepted,
      });
    } else {
      res.status(200).json({});
    }
  } catch (error) {
    console.error("Error cancelling connection request", error);
    res.status(500).send({ message: "Internal server error" });
  }
});

//getting messages recieved by a user - DAVID
app.get("/messages/:username", async (req, res) => {
  try {
    const username = req.params.username;

    // UPDATED FOR COLUMN NAMES: maps to sender_id and receiver_id
    const { data: result, error } = await supabase
      .from("messages")
      .select("*")
      .or(`receiver_id.eq.${username},sender_id.eq.${username}`);

    if (error) throw error;

    // Map database snake_case keys back to camelCase so your frontend doesn't break
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

//     res.json(result)
//   }catch(error){
//      console.error("Error getting messages", error);
//     res.status(500).send({ message: "Internal server error" });
//   }
// });

//posting a new message - DAVID
app.post("/sendAMessage", async (req, res) => {
  try {
    // UPDATED FOR COLUMN NAMES: maps incoming keys to exact Supabase columns
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

//     const username = req.params.username;
//     const result = await db.collection("messages").insertOne(req.body)

//     res.send(200).json({message:"successsfully sent"})
//   }catch(error){
//     console.error("Error sending messages", error);
//     res.status(500).json({ error: "Internal server error" });
//   }
// });

server.listen(port, async () => {
  console.log(`Server is running on http://localhost:${port}`);
  await connectToMongo();
});
