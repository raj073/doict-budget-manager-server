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
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "https://doict-budget-manager-client.vercel.app",
    ],
  })
);
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
    await client.connect();

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


      // Now update the upazilaCodewiseBudget collection
      const upazila = await upazilaCodewiseBudgetCollection.findOne({
        upazilaId,
      });

      // Insert distribution record
      const result = await budgetDistributionCollection.insertOne(req.body);
      res.send(result);
    });

    // Budget Distribution Upload Excel File
    app.post("/uploadExcel", upload.single("csvFile"), async (req, res) => {
      const filePath = req.file.path;
      const expectedHeaders = [
        "SL",
        "SerialCode",
        "OfficeName",
        "EntertainmentExpenses",
        "Internet",
      ];
      try {
        // Convert CSV to JSON using csvtojson
        const jsonArray = await csv().fromFile(filePath);
        console.log(jsonArray);

        // Validate CSV headers
        const csvHeaders = Object.keys(jsonArray[0]);
        const isValidHeaders = expectedHeaders.every((header) =>
          csvHeaders.includes(header)
        );

        if (!isValidHeaders) {
          // Delete the uploaded file if headers are invalid
          if (fs.existsSync(filePath)) {
            fs.unlink(filePath, (err) => {
              if (err) {
                console.error("Error deleting file:", err);
              }
            });
          }
          return res.status(400).json({
            error:
              "Invalid CSV file detected. Headers do not match. Please check and re-upload.",
          });
        }

        // Check for duplicates in the database
        const serialCodes = jsonArray.map((sl) => sl.SerialCode);
        console.log("SerialCode After Map:", serialCodes);
        const existingRecords = await budgetDistributionCollection
          .find({
            SerialCode: { $in: serialCodes },
          })
          .toArray();
        console.log("Existing Records:", existingRecords);

        const existingSerialCodes = new Set(
          existingRecords.map((record) => record.SerialCode)
        );
        console.log("Existing Serial Codes:", existingSerialCodes);

        // //Filter out duplicates
        const nonDuplicateRecords = jsonArray.filter(
          (record) => !existingSerialCodes.has(record.SerialCode)
        );

        console.log(
          "Non Duplicate Records length:",
          nonDuplicateRecords.length
        );

        const duplicateCount = jsonArray.length - nonDuplicateRecords.length;
        console.log("Duplicate Count:", duplicateCount);

        if (nonDuplicateRecords.length === 0) {
          fs.unlinkSync(filePath);
          return res.status(409).json({
            error: "All Records are Duplicates. No New Records Were Added.",
          });
        }

        if (nonDuplicateRecords.length > 0) {
          await budgetDistributionCollection.insertMany(nonDuplicateRecords);
          return res.status(200).json({
            message:
              duplicateCount > 0
                ? `Successfully Added ${nonDuplicateRecords.length} Rows. Skipped ${duplicateCount} Duplicate Rows.`
                : "CSV File Imported Successfully into Database",
            inserted: nonDuplicateRecords.length,
            duplicates: duplicateCount,
          });
        }
      } catch (err) {
        console.error("Error processing CSV:", err);
        res.status(500).json({ error: "Failed to Process CSV File" });
      } finally {
        // Clean up the uploaded file
        fs.unlinkSync(filePath);
      }
    });

    // Expense Management for Users
    app.get("/expenses/:uid", async (req, res) => {
      const uid = req.params.uid;
      const expenses = await budgetDistributionCollection
        .find({ userId: uid })
        .toArray();
      res.send(expenses);
    });


      if (upazila) {
        // If upazila already exists, add the new allocations to the existing allocations
        const updatedAllocations = upazila.allocations.map((allocation) => {
          if (allocation.economicCode === economicCode) {
            allocation.distributed += distributedBudget; // Update the distributed amount
          }
          return allocation;
        });

        // If economicCode does not exist in allocations, add a new entry for it
        if (
          !upazila.allocations.some(
            (allocation) => allocation.economicCode === economicCode
          )
        ) {
          updatedAllocations.push({
            economicCode,
            distributed: distributedBudget,
          });
        }

        // Update the upazilaCodewiseBudget collection with the updated allocations
        await upazilaCodewiseBudgetCollection.updateOne(
          { upazilaId },
          { $set: { allocations: updatedAllocations } }
        );
      } else {
        // If upazila does not exist, create a new entry for it
        const newUpazilaData = {
          upazilaId,
          upazilaName: req.body.upazilaName, // Ensure this data is coming from the request body
          allocations: [
            {
              economicCode,
              distributed: distributedBudget,
            },
          ],
          createdAt: new Date(),
        };

        await upazilaCodewiseBudgetCollection.insertOne(newUpazilaData);
      }

      // Respond with success message and updated budget information
      const updatedEconomicCode = await economicCodesCollection.findOne({
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

      try {
        // Find or create upazila entry
        const upazila = await upazilaCodewiseBudgetCollection.findOne({
          upazilaId,
        });

        if (upazila) {
          // Update existing upazila distribution
          const updatedAllocations = upazila.allocations.concat(allocations);
          await upazilaCodewiseBudgetCollection.updateOne(
            { upazilaId },
            { $set: { allocations: updatedAllocations } }
          );
          res.status(200).send({ message: "Budget updated successfully" });
        } else {
          // Create new upazila distribution
          const distributionData = {
            upazilaId,
            upazilaName,
            allocations,
            createdAt: new Date(),
          };
          const result = await upazilaCodewiseBudgetCollection.insertOne(
            distributionData
          );
          res
            .status(201)
            .send({ message: "Budget distributed successfully", result });
        }
      } catch (error) {
        console.error("Error distributing budget:", error);
        res
          .status(500)
          .send({ error: "Failed to distribute budget. Please try again." });
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
