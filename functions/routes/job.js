import express from "express";
import admin from "firebase-admin";

const router = express.Router();

// Middleware: verify token and attach user info
async function verifyToken(req, res, next) {
  const idToken = req.headers.authorization?.split("Bearer ")[1];
  if (!idToken) return res.status(401).send("Unauthorized");

  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    const userDoc = await admin.firestore().doc(`users/${decoded.uid}`).get();
    if (!userDoc.exists) return res.status(403).send("User not found");

    req.user = {
      uid: decoded.uid,
      role: userDoc.data().role,
    };
    next();
  } catch (err) {
    console.error("Token verification error:", err);
    return res.status(403).send("Invalid token");
  }
}

// GET /job/:jobId
router.get("/:jobId", verifyToken, async (req, res) => {
  const { jobId } = req.params;
  const { uid, role } = req.user;

  try {
    const jobDoc = await admin.firestore().doc(`jobs/${jobId}`).get();
    if (!jobDoc.exists) return res.status(404).send("Job not found");

    const job = jobDoc.data();
    if (
      (role === "employer" && job.employerId !== uid) ||
      (role === "student" && job.studentId !== uid)
    ) {
      return res.status(403).send("Access denied");
    }

    res.status(200).json({ id: jobDoc.id, ...job });
  } catch (error) {
    console.error("Error fetching job:", error.message);
    res.status(500).send("Failed to retrieve job");
  }
});

// POST /job
router.post("/", verifyToken, async (req, res) => {
  const { title, description, price, location, skills } = req.body;
  const { uid, role } = req.user;

  if (role !== "employer") return res.status(403).send("Only employers can create jobs");
  if (!title || !description || !price || !location || !skills) {
    return res.status(400).send("All fields are required");
  }

  try {
    const jobRef = await admin.firestore().collection("jobs").add({
      title,
      description,
      price,
      location,
      skills,
      employerId: uid,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      status: "pending",
      verified: false
    });

    res.status(201).json({ jobId: jobRef.id });
  } catch (error) {
    console.error("Error creating job:", error.message);
    res.status(500).send("Failed to create job");
  }
});

// GET /job
router.get("/", verifyToken, async (req, res) => {
  const { uid, role } = req.user;

  try {
    const query = admin.firestore().collection("jobs");
    const snapshot = await (
      role === "employer"
        ? query.where("employerId", "==", uid)
        : query.where("studentId", "==", uid)
    ).orderBy("createdAt", "desc").get();

    const jobs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json(jobs);
  } catch (error) {
    console.error("Error fetching jobs:", error.message);
    res.status(500).send("Failed to retrieve jobs");
  }
});

// PUT /job/:jobId
router.put("/:jobId", verifyToken, async (req, res) => {
  const { jobId } = req.params;
  const { title, description, price, location, skills } = req.body;
  const { uid, role } = req.user;

  if (role !== "employer") return res.status(403).send("Only employers can edit jobs");

  try {
    const jobRef = admin.firestore().doc(`jobs/${jobId}`);
    const jobDoc = await jobRef.get();

    if (!jobDoc.exists) return res.status(404).send("Job not found");
    if (jobDoc.data().employerId !== uid) return res.status(403).send("Unauthorized");

    await jobRef.update({ title, description, price, location, skills });
    res.status(200).send("Job updated successfully");
  } catch (error) {
    console.error("Update error:", error.message);
    res.status(500).send("Failed to update job");
  }
});

// PUT /job/:jobId/assign/:studentId
router.put("/:jobId/assign/:studentId", verifyToken, async (req, res) => {
  const { jobId, studentId } = req.params;
  const { uid, role } = req.user;

  if (role !== "employer") return res.status(403).send("Only employers can assign jobs");

  try {
    const jobDoc = await admin.firestore().doc(`jobs/${jobId}`).get();
    if (!jobDoc.exists) return res.status(404).send("Job not found");

    const studentDoc = await admin.firestore().doc(`users/${studentId}`).get();
    if (!studentDoc.exists || studentDoc.data().role !== "student") {
      return res.status(404).send("Student not found");
    }

    await jobDoc.ref.update({ studentId });
    res.status(200).send("Job assigned successfully");
  } catch (error) {
    console.error("Assignment error:", error.message);
    res.status(500).send("Failed to assign job");
  }
});

// PUT /job/:jobId/verify
router.put("/:jobId/verify", verifyToken, async (req, res) => {
  const { jobId } = req.params;
  const { uid, role } = req.user;

  if (role !== "employer") return res.status(403).send("Only employers can verify");

  try {
    const jobDoc = await admin.firestore().doc(`jobs/${jobId}`).get();
    if (!jobDoc.exists) return res.status(404).send("Job not found");

    const jobData = jobDoc.data();
    if (jobData.employerId !== uid) return res.status(403).send("Unauthorized");
    if (jobData.status !== "completed") return res.status(400).send("Job not completed yet");

    await jobDoc.ref.update({ verified: true });
    res.status(200).send("Job verified successfully");
  } catch (error) {
    console.error("Verify error:", error.message);
    res.status(500).send("Failed to verify job");
  }
});

// PUT /job/:jobId/accept
router.put("/:jobId/accept", verifyToken, async (req, res) => {
  const { jobId } = req.params;
  const { uid, role } = req.user;

  if (role !== "student") return res.status(403).send("Only students can accept jobs");

  try {
    const jobDoc = await admin.firestore().doc(`jobs/${jobId}`).get();
    if (!jobDoc.exists) return res.status(404).send("Job not found");
    if (jobDoc.data().studentId !== uid) {
      return res.status(403).send("Not your assigned job");
    }

    await jobDoc.ref.update({ status: "accepted" });
    res.status(200).send("Job accepted");
  } catch (error) {
    console.error("Accept error:", error.message);
    res.status(500).send("Failed to accept job");
  }
});

// PUT /job/:jobId/reject
router.put("/:jobId/reject", verifyToken, async (req, res) => {
  const { jobId } = req.params;
  const { uid, role } = req.user;

  if (role !== "student") return res.status(403).send("Only students can reject jobs");

  try {
    const jobDoc = await admin.firestore().doc(`jobs/${jobId}`).get();
    if (!jobDoc.exists) return res.status(404).send("Job not found");
    if (jobDoc.data().studentId !== uid) {
      return res.status(403).send("Not your assigned job");
    }

    await jobDoc.ref.update({ status: "rejected" });
    res.status(200).send("Job rejected");
  } catch (error) {
    console.error("Reject error:", error.message);
    res.status(500).send("Failed to reject job");
  }
});

// PUT /job/:jobId/complete
router.put("/:jobId/complete", verifyToken, async (req, res) => {
  const { jobId } = req.params;
  const { uid, role } = req.user;

  if (role !== "student") return res.status(403).send("Only students can complete jobs");

  try {
    const jobDoc = await admin.firestore().doc(`jobs/${jobId}`).get();
    if (!jobDoc.exists) return res.status(404).send("Job not found");
    if (jobDoc.data().studentId !== uid) {
      return res.status(403).send("Not your assigned job");
    }

    await jobDoc.ref.update({ status: "completed" });
    res.status(200).send("Job marked as completed");
  } catch (error) {
    console.error("Complete error:", error.message);
    res.status(500).send("Failed to complete job");
  }
});

export default router;
