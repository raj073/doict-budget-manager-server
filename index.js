const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "https://doict-budget-manager-client.vercel.app",
    ],
  })
);
app.use(express.json());

// MongoDB URI
const uri = process.env.DB_URI;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// Function to run the server and database connection
async function run() {
  try {
    await client.connect();

    // Database Collections
    const db = client.db("budget-manager");
    const userCollection = db.collection("users");
    const upazilaCollection = db.collection("upazila_info");
    const economicCodesCollection = db.collection("economicCodes");
    const budgetDistributionCollection = db.collection("budgetDistributions");
    const messagesCollection = db.collection("messages");

    // Routes for User Management
    app.get("/users", async (req, res) => {
      const users = await userCollection.find().toArray();
      res.send(users);
    });

    app.get("/user/:uid", async (req, res) => {
      const uid = req.params.uid;
      const user = await userCollection.findOne({ uid });
      res.send(user);
    });

    app.post("/users", async (req, res) => {
      const user = req.body;
      console.log("Req-Body:", user);
      const result = await userCollection.insertOne(user);
      console.log("Result:", result);
      res.send(result);
    });

    app.put("/user/:id", async (req, res) => {
      const id = req.params.id;
      const user = req.body;
      const filter = { _id: new ObjectId(id) };
      const updatedUser = { $set: { ...user } };
      const result = await userCollection.updateOne(filter, updatedUser, {
        upsert: true,
      });
      res.send(result);
    });

    app.delete("/user/:id", async (req, res) => {
      const id = req.params.id;
      const result = await userCollection.deleteOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });

    app.get("/upazila", async (req, res) => {
      const upazilaInfo = await upazilaCollection
        .find()
        .project({ _id: 0 })
        .toArray();
      res.send(upazilaInfo);
    });

    app.post("/upazila", async (req, res) => {
      const upazilaInfo = req.body;
      upazilaInfo.fullFieldOfficeCode =
        upazilaInfo.instituteCode + upazilaInfo.fieldOfficeCode;
      const result = await upazilaCollection.insertOne(upazilaInfo);
      res.send(result);
    });

    // Economic Codes Management for Admin
    app.get("/economicCodes", async (req, res) => {
      const codes = await economicCodesCollection.find().toArray();
      res.send(codes);
    });

    app.post("/economicCodes", async (req, res) => {
      const code = req.body;
      console.log(code);
      code.distributedBudget = 0; // Initialize distributed budget
      const result = await economicCodesCollection.insertOne(code);
      res.send(result);
    });

    // Budget Distribution Management for Admin
    app.get("/budgetDistributions", async (req, res) => {
      const distributions = await budgetDistributionCollection.find().toArray();
      res.send(distributions);
    });

    app.post("/budgetDistributions", async (req, res) => {
      const { upazilaId, economicCode, distributedBudget } = req.body;

      // Find Economic Code
      const economicCodeData = await economicCodesCollection.findOne({
        economicCode,
      });

      if (!economicCodeData) {
        return res.status(404).send({ error: "Economic Code not found" });
      }

      // Calculate remaining budget
      const remainingBudget =
        economicCodeData.totalBudget - economicCodeData.distributedBudget;

      if (distributedBudget > remainingBudget) {
        return res
          .status(400)
          .send({ error: "Distributed amount exceeds available budget" });
      }

      // Update distributed budget
      await economicCodesCollection.updateOne(
        { economicCode },
        { $inc: { distributedBudget } }
      );

      // Insert distribution record
      const result = await budgetDistributionCollection.insertOne(req.body);
      res.send(result);
    });

    // Expense Management for Users
    app.get("/expenses/:uid", async (req, res) => {
      const uid = req.params.uid;
      const expenses = await budgetDistributionCollection
        .find({ userId: uid })
        .toArray();
      res.send(expenses);
    });

    app.post("/expenses", async (req, res) => {
      const { uid, economicCode, expenseAmount } = req.body;

      // Find User's Budget Distribution
      const distribution = await budgetDistributionCollection.findOne({
        userId: uid,
        economicCode,
      });

      if (!distribution) {
        return res.status(404).send({ error: "Budget distribution not found" });
      }

      // Check if expense exceeds distributed budget
      const remaining =
        distribution.distributedBudget - distribution.expenseBudget;
      if (expenseAmount > remaining) {
        return res
          .status(400)
          .send({ error: "Expense amount exceeds remaining budget" });
      }

      // Update expense
      await budgetDistributionCollection.updateOne(
        { userId: uid, economicCode },
        { $inc: { expenseBudget: expenseAmount } }
      );

      res.send({ message: "Expense added successfully" });
    });

    // Messages Management
    app.post("/messages", async (req, res) => {
      const message = req.body;
      message.createdAt = new Date();
      const result = await messagesCollection.insertOne(message);
      res.send(result);
    });

    app.get("/messages", async (req, res) => {
      const messages = await messagesCollection.find().toArray();
      res.send(messages);
    });

    app.get("/messages/:id", async (req, res) => {
      const id = req.params.id;
      const message = await messagesCollection.findOne({
        _id: new ObjectId(id),
      });
      res.send(message);
    });

    // Test Connection
    await client.db("admin").command({ ping: 1 });
    console.log("DBMS System Connected to MongoDB.");
  } finally {
    // Keep connection open
  }
}
run().catch(console.error);

// Base route
app.get("/", (req, res) => {
  res.send("DoICT Budget Manager Server is Running!");
});

app.listen(port, () => {
  console.log(`DoICT Budget Manager Server Running on port ${port}`);
});
