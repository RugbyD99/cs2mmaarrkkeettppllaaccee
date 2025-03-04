const express = require("express");
const mongoose = require("mongoose");
const session = require("express-session");
const passport = require("passport");
const SteamStrategy = require("passport-steam").Strategy;
const axios = require("axios");
const dotenv = require("dotenv");
const cors = require("cors");

dotenv.config();
const app = express();
app.use(express.json());
app.use(cors());

// MongoDB Verbindung
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// Session & Auth Setup
app.use(session({ secret: "secret", resave: false, saveUninitialized: false }));
app.use(passport.initialize());
app.use(passport.session());

// Steam Auth
passport.use(
  new SteamStrategy(
    {
      returnURL: "http://localhost:3000/auth/steam/return",
      realm: "http://localhost:3000/",
      apiKey: process.env.STEAM_API_KEY,
    },
    (identifier, profile, done) => {
      return done(null, profile);
    }
  )
);
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

// Models
const Skin = mongoose.model("Skin", new mongoose.Schema({
  steamId: String,
  name: String,
  price: Number,
  float: Number,
  image: String,
  listedAt: { type: Date, default: Date.now },
}));

// Steam Auth Routes
app.get("/auth/steam", passport.authenticate("steam", { failureRedirect: "/" }));
app.get("/auth/steam/return", passport.authenticate("steam", { failureRedirect: "/" }), (req, res) => res.redirect("/"));
app.get("/profile", (req, res) => req.isAuthenticated() ? res.json(req.user) : res.status(401).json({ error: "Not logged in" }));

// Inventar von Steam abrufen
async function getSteamInventory(steamId) {
  try {
    const url = `https://steamcommunity.com/inventory/${steamId}/730/2?l=english&count=5000`;
    const response = await axios.get(url);
    return response.data.assets.map(asset => asset.classid); 
  } catch (error) {
    console.error("Fehler beim Laden des Inventars:", error);
    return [];
  }
}

// Skin hinzufügen (nur wenn er im Inventar ist)
app.post("/skins", async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: "Not logged in" });

  const { name, price, float, image } = req.body;
  const userInventory = await getSteamInventory(req.user.id);
  
  if (!userInventory.includes(name)) return res.status(400).json({ error: "Skin nicht im Inventar" });

  const newSkin = new Skin({ steamId: req.user.id, name, price, float, image });
  await newSkin.save();
  res.json({ success: true, skin: newSkin });
});

// Alle Skins abrufen + Filter
app.get("/skins", async (req, res) => {
  const { minPrice, maxPrice, minFloat, maxFloat, name } = req.query;
  let filter = {};
  if (minPrice) filter.price = { $gte: Number(minPrice) };
  if (maxPrice) filter.price = { ...filter.price, $lte: Number(maxPrice) };
  if (minFloat) filter.float = { $gte: Number(minFloat) };
  if (maxFloat) filter.float = { ...filter.float, $lte: Number(maxFloat) };
  if (name) filter.name = new RegExp(name, "i");

  const skins = await Skin.find(filter).sort({ price: 1 });
  res.json(skins);
});

// Server starten
app.listen(process.env.PORT, () => console.log(`Server läuft auf Port ${process.env.PORT}`));
