const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const multer = require("multer");
const csv = require("csvtojson");
const path = require("path");
const fs = require("fs");

const app = express();
const port = process.env.PORT || 5000;

// Middleware
// app.use(
//   cors({
//     origin: [
//       "http://localhost:5173",
//       "https://doict-budget-manager-7c9f1.web.app/",
//     ],
//   })
// );
app.use(cors());
app.use(express.json());

// Multer Excel Upload Middleware
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "./uploads");
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  },
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (path.extname(file.originalname) !== ".csv") {
      return cb(new error("Only CSV Files are allowed"));
    }
    cb(null, true);
  },
});

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
    // await client.connect();

    // Database Collections
    const db = client.db("budget-manager");
    const userCollection = db.collection("users");
    const upazilaCollection = db.collection("upazila_info");
    const economicCodesCollection = db.collection("economicCodes");
    const budgetDistributionCollection = db.collection("budgetDistributions");
    const distributedBudgetCollection = db.collection("distributedBudget");
    const messagesCollection = db.collection("messages");
    const upazilaCodewiseBudgetCollection = db.collection(
      "upazilaCodewiseBudget"
    );
    const upazilaBudgetDemandCollection = db.collection("upazilaBudgetDemand");
    const upazilaBudgetExpenseCollection = db.collection(
      "upazilaBudgetExpense"
    );

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

    // Upazila Management
    app.get("/upazila", async (req, res) => {
      const upazilaInfo = await upazilaCollection
        .find()
        .project({ _id: 0 })
        .toArray();
      res.send(upazilaInfo);
    });

    app.post("/upazila", async (req, res) => {
      const upazilaInfo = req.body;
      const result = await upazilaCollection.insertOne(upazilaInfo);
      res.send(result);
    });

    // Economic Codes Management for Admin
    app.get("/economicCodes", async (req, res) => {
      const codes = await economicCodesCollection.find().toArray();
      res.send(codes);
    });

    app.post("/economicCodes", async (req, res) => {
      const { economicCode, distributedAmount } = req.body;

      if (!economicCode || !distributedAmount) {
        return res
          .status(400)
          .send({ error: "Economic code and distributed amount are required" });
      }

      try {
        // Update the economicCodes collection by incrementing the distributed amount
        const updatedEconomicCode = await economicCodesCollection.updateOne(
          { economicCode },
          { $inc: { distributedBudget: distributedAmount } }
        );

        if (updatedEconomicCode.modifiedCount === 0) {
          return res.status(404).send({ error: "Economic code not found" });
        }

        res.send({ message: "Economic code updated successfully" });
      } catch (error) {
        console.error("Error updating economic code:", error);
        res.status(500).send({ error: "Internal server error" });
      }
    });

    // Budget Distribution Management for Admin
    app.get("/budgetDistributions", async (req, res) => {
      const distributions = await budgetDistributionCollection.find().toArray();
      res.send(distributions);
    });

    app.post("/budgetDistributions", async (req, res) => {
      const { upazilaId, economicCode, distributedBudget } = req.body;

      // Validate fields
      if (!upazilaId || !economicCode || !distributedBudget) {
        return res.status(400).send({ error: "All fields are required" });
      }

      // Validate that distributedBudget is a positive number
      if (distributedBudget <= 0) {
        return res
          .status(400)
          .send({ error: "Distributed budget must be greater than 0" });
      }

      // Find Economic Code
      const economicCodeData = await economicCodesCollection.findOne({
        economicCode,
      });

      if (!economicCodeData) {
        return res.status(404).send({ error: "Economic Code not found" });
      }

      // Calculate remaining budget in the economic code
      const remainingBudget =
        economicCodeData.totalBudget - economicCodeData.distributedBudget;

      if (distributedBudget > remainingBudget) {
        return res
          .status(400)
          .send({ error: "Distributed amount exceeds available budget" });
      }

      // Update distributed budget in the economicCodes collection
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
      res.send({
        message: "Budget distributed successfully",
        updatedEconomicCode, // Send the updated economic code data
      });
    });

    // Endpoint to distribute budget data for each upazila

    app.post("/upazilaCodewiseBudget", async (req, res) => {
      const { upazilaId, upazilaName, allocations } = req.body;

      // Validate input
      if (
        !upazilaId ||
        !upazilaName ||
        !allocations ||
        allocations.length === 0
      ) {
        return res.status(400).send({ error: "Invalid or missing data." });
      }

      console.log("Allocations Data:", allocations); // Debugging line to log incoming data

      try {
        // Step 1: Check if upazila already exists
        const existingUpazila = await upazilaCodewiseBudgetCollection.findOne({
          upazilaId,
        });

        if (!existingUpazila) {
          // If upazila does not exist, create a new document
          await upazilaCodewiseBudgetCollection.insertOne({
            upazilaId,
            upazilaName,
            allocations,
          });
          return res.send({
            message: "Upazila and allocations added successfully!",
          });
        } else {
          // Step 2: Ensure allocations is always an array
          const allocationsArray = existingUpazila.allocations || [];

          const bulkOperations = [];

          allocations.forEach(({ economicCode, amount }) => {
            bulkOperations.push({
              updateOne: {
                filter: { upazilaId, "allocations.economicCode": economicCode },
                update: {
                  $inc: { "allocations.$.amount": amount }, // Increment amount if economicCode exists
                },
                upsert: false, // Do not insert if no match is found
              },
            });
          });

          // Perform bulk operations to update existing allocations
          const result = await upazilaCodewiseBudgetCollection.bulkWrite(
            bulkOperations
          );

          // Step 3: Handle new allocations (economic codes that do not exist)
          const unmatchedAllocations = allocations.filter(
            ({ economicCode }) => {
              return !allocationsArray.some(
                (allocation) => allocation.economicCode === economicCode
              );
            }
          );

          if (unmatchedAllocations.length > 0) {
            // Push new allocations for unmatched economic codes
            await upazilaCodewiseBudgetCollection.updateOne(
              { upazilaId },
              {
                $push: { allocations: { $each: unmatchedAllocations } },
              }
            );
          }

          res.send({ message: "Budget data updated successfully!" });
        }
      } catch (error) {
        console.error("Error distributing budget:", error);
        res.status(500).send({ error: "Failed to distribute budget." });
      }
    });

    // Endpoint to retrieve distributed budget data by upazila and economic code
    app.get("/upazilaCodewiseBudget", async (req, res) => {
      try {
        const distributions = await upazilaCodewiseBudgetCollection
          .find()
          .toArray();
        res.send(distributions);
      } catch (error) {
        console.error("Error fetching budget data:", error);
        res.status(500).send({
          error: "Failed to retrieve budget data. Please try again.",
        });
      }
    });

    app.get("/upazilaCodewiseBudget/:upazilaId", async (req, res) => {
      const { upazilaId } = req.params;
      try {
        const distribution = await upazilaCodewiseBudgetCollection.findOne({
          upazilaId,
        });
        if (!distribution) {
          return res
            .status(404)
            .send({ error: "No budget data found for this upazila." });
        }
        res.send(distribution);
      } catch (error) {
        console.error("Error fetching upazila budget data:", error);
        res.status(500).send({ error: "Failed to retrieve budget data." });
      }
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

    // Upazila Budget Demand

    app.get("/upazilaBudgetDemand", async (req, res) => {
      const users = await upazilaBudgetDemandCollection.find().toArray();
      res.send(users);
    });
    app.post("/upazilaBudgetDemand", async (req, res) => {
      const demandData = req.body;

      try {
        const result = await upazilaBudgetDemandCollection.insertOne(
          demandData
        );
        res.status(201).send({
          success: true,
          message: "Demand data saved successfully",
          result,
        });
      } catch (error) {
        console.error("Error saving demand data:", error);
        res
          .status(500)
          .send({ success: false, message: "Failed to save demand data" });
      }
    });

    // User Upazila Codewise Budget Expense

    app.get("/upazilaBudgetExpense", async (req, res) => {
      try {
        const users = await upazilaBudgetExpenseCollection.find().toArray();
        res.send(users);
      } catch (error) {
        console.error("Error fetching expense data:", error);
        res
          .status(500)
          .send({ success: false, message: "Failed to fetch data" });
      }
    });

    app.post("/upazilaBudgetExpense", async (req, res) => {
      const expenseData = req.body;
      const { upazilaCode, expenseCollections } = expenseData;

      try {
        // Check if the upazila already exists in the collection
        const existingExpenseData =
          await upazilaBudgetExpenseCollection.findOne({ upazilaCode });

        if (existingExpenseData) {
          // If upazila exists, update its expense data
          const updatedExpenseCollections =
            existingExpenseData.expenseCollections.map((existingItem) => {
              const newItem = expenseCollections.find(
                (item) => item.economicCode === existingItem.economicCode
              );
              if (newItem) {
                return {
                  ...existingItem,
                  expenseBudget:
                    existingItem.expenseBudget + newItem.expenseBudget,
                };
              }
              return existingItem;
            });

          // If some new codes are not present in the existing data, add them
          const newItems = expenseCollections.filter(
            (newItem) =>
              !existingExpenseData.expenseCollections.some(
                (existingItem) =>
                  existingItem.economicCode === newItem.economicCode
              )
          );

          const updatedExpenseData = {
            ...existingExpenseData,
            expenseCollections: [...updatedExpenseCollections, ...newItems],
          };

          await upazilaBudgetExpenseCollection.updateOne(
            { upazilaCode },
            { $set: updatedExpenseData }
          );
          res.status(200).send({
            success: true,
            message: "Expense data updated successfully",
          });
        } else {
          // If upazila doesn't exist, insert the new expense data
          await upazilaBudgetExpenseCollection.insertOne(expenseData);
          res.status(201).send({
            success: true,
            message: "Expense data saved successfully",
          });
        }
      } catch (error) {
        console.error("Error saving or updating expense data:", error);
        res.status(500).send({
          success: false,
          message: "Failed to save or update expense data",
        });
      }
    });

    // Test DB Connection
    // await client.db("admin").command({ ping: 1 });
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
