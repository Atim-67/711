import express from "express";
import admin from "firebase-admin";

const router = express.Router();

/**
 * JOBS api
 *
 * Scenario:
 * - Employers can create jobs specifying title, description, price, location, and required skills and softskills. (POST /)
 * - Employers can view the list of jobs they have created. (GET /)
 * - Students can also the list of jobs assigned to them (GET /)
 *    - In GET /job, if the user role is "student", the job list is filtered to only include jobs where the current studentId appears in just one assignment in the `assignments[]` array.
 * - Employers can assign a job to one or more students based on skills and softSkills on the job edit form page (Searching students by skill and softSkills in the "job edit page" is handled in employer.js GET /employer/students/skills/:skill)
 * - Students can view the list of jobs assigned to them. This is done by filtering jobs where their studentId exists in the `assignments[]` array. (GET /)
 * - Each student can independently accept, reject, or complete their assigned job.
 *    - Students can use (PUT /:jobId/accept) to accept the job 
 *    - Students can use (PUT /:jobId/reject) to reject the job
 *    - Students can use (PUT /:jobId/complete) to complete the accepted job
 * - Once a student marks their assignment as completed, the employer can verify the job assigned to student. 
 *    - Students can use (PUT /:jobId/verify) to verify the job 
 *
 * - Employers can delete a job only if there are no assigned students (DELETE /:jobId)
 * - Employers can search students by their skills and softSkills in the Search page (Searching students by skill and softSkills in the  "search page" is handled in employer.js GET /search-students)
 * - Students and Employers can get job details using: GET /jobs/:jobId
 * 
 * - Employers can see the student digital skill wallet when they click on "Show Dashboard" in the the "Search student page" or in the job edit form (Matching Students section) (will navigate to /digital-skill-wallet/${studentId})
 *
 * Job Document Structure:
 * - title: string (Mandatory)
 * - description: string (Mandatory)
 * - price: number (Mandatory)
 * - location: string (Mandatory)
 * - skills: array of strings (Mandatory) 
 * - softSkills array of strings (Not mandatory)
 * - employerId: string (UID of the employer) (Mandatory)
 * - assignments: array of objects, each containing:
 *     - studentId: string
 *     - status: string ("assigned", "accepted", "rejected", "completed", "verified")
 *     - timestamp: string (ISO date)
 * - createdAt: string (ISO date)
 *
 * Job Status Workflow (per student assignment):
 * 1. Created → Job starts with an empty `assignments` array
 * 2. Assigned → A student is added to `assignments[]` with status: "assigned"
 * 3. Student Accepts → That assignment's status becomes: "accepted"
 * 4. Student Rejects → That assignment's status becomes: "rejected"
 * 5. Student Completes → That assignment's status becomes: "completed"
 * 6. Employer Verifies → That assignment's status becomes: "verified"
 *
 */

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

    // Authorization check
    if (role === "employer" && job.employerId !== uid) {
      return res.status(403).send("You do not own this job");
    }

    if (role === "student") {
      const isAssigned = (job.assignments || []).some(
        (a) => a.studentId === uid
      );
      if (!isAssigned)
        return res.status(403).send("You are not assigned to this job");
    }

    // Populate assignment details
    let detailedAssignments = [];

    if (job.assignments?.length) {
      detailedAssignments = await Promise.all(
        job.assignments.map(async (a) => {
          const studentDoc = await admin
            .firestore()
            .doc(`users/${a.studentId}`)
            .get();
          if (!studentDoc.exists) return a;

          const student = studentDoc.data();
          const detailed = {
            ...a,
            student: {
              id: a.studentId,
              name: student.name || "",
              schoolId: student.schoolId || "",
            },
          };

          if (student.schoolId) {
            const schoolSnap = await admin
              .firestore()
              .collection("schools")
              .where("code", "==", student.schoolId)
              .limit(1)
              .get();

            if (!schoolSnap.empty) {
              detailed.student.schoolName = schoolSnap.docs[0].data().name;
            }
          }

          return detailed;
        })
      );
    }

    res.status(200).json({
      id: jobDoc.id,
      ...job,
      assignments: detailedAssignments,
    });
  } catch (error) {
    console.error("Error fetching job:", error.message);
    res.status(500).send("Failed to retrieve job");
  }
});

// POST /job
router.post("/", verifyToken, async (req, res) => {
  const { title, description, price, location, skills, softSkills } = req.body;
  const { uid, role } = req.user;

  if (role !== "employer")
    return res.status(403).send("Only employers can create jobs");

  if (!title || !description || !price || !location || !skills) {
    return res.status(400).send("All fields are required");
  }

  try {
    const jobRef = await admin
      .firestore()
      .collection("jobs")
      .add({
        title,
        description,
        price,
        location,
        skills,
        softSkills: softSkills || [],
        employerId: uid,
        createdAt: new Date().toISOString(),
        status: "pending",
        verified: false,
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
    const query = admin
      .firestore()
      .collection("jobs")
      .orderBy("createdAt", "desc");
    const snapshot = await query.get();

    let jobs = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

    const softSkillsSnapshot = await admin
      .firestore()
      .collection("soft-skills")
      .get();
    const softSkillMap = {};
    softSkillsSnapshot.forEach((doc) => {
      softSkillMap[doc.id] = doc.data().name;
    });

    // If student: filter jobs where user is in assignments
    if (role === "student") {
      jobs = jobs.filter((job) =>
        (job.assignments || []).some((a) => a.studentId === uid)
      );
    } else if (role === "employer") {
      jobs = jobs.filter((job) => job.employerId === uid);
    }

    const enrichedJobs = await Promise.all(
      jobs.map(async (job) => {
        if (!job.assignments?.length) return job;

        job.assignments = await Promise.all(
          job.assignments.map(async (a) => {
            const studentDoc = await admin
              .firestore()
              .doc(`users/${a.studentId}`)
              .get();
            if (!studentDoc.exists) return a;

            const student = studentDoc.data();
            const assignmentWithDetails = {
              ...a,
              student: {
                id: a.studentId,
                name: student.name || "",
                schoolId: student.schoolId || "",
              },
            };

            if (student.schoolId) {
              const schoolSnapshot = await admin
                .firestore()
                .collection("schools")
                .where("code", "==", student.schoolId)
                .limit(1)
                .get();

              if (!schoolSnapshot.empty) {
                assignmentWithDetails.student.schoolName =
                  schoolSnapshot.docs[0].data().name;
              }
            }

            return assignmentWithDetails;
          })
        );

        return job;
      })
    );

    const jobsWithSoftSkillNames = enrichedJobs.map((job) => ({
      ...job,
      softSkills: (job.softSkills || []).map((id) => softSkillMap[id] || id),
    }));
    res.json(jobsWithSoftSkillNames);
  } catch (error) {
    console.error("Error fetching jobs:", error.message);
    res.status(500).send("Failed to retrieve jobs");
  }
});

// PUT /employer/job/:jobId
router.put("/:jobId", verifyToken, async (req, res) => {
  const { jobId } = req.params;
  const { title, description, price, location, skills, softSkills } = req.body;

  const { uid, role } = req.user;

  if (role !== "employer")
    return res.status(403).send("Only employers can edit jobs");

  try {
    const jobRef = admin.firestore().doc(`jobs/${jobId}`);
    const jobDoc = await jobRef.get();

    if (!jobDoc.exists) return res.status(404).send("Job not found");
    if (jobDoc.data().employerId !== uid)
      return res.status(403).send("Unauthorized");

    await jobRef.update({
      title,
      description,
      price,
      location,
      skills,
      softSkills: softSkills || [],
    });

    res.status(200).send("Job updated successfully");
  } catch (error) {
    console.error("Update error:", error.message);
    res.status(500).send("Failed to update job");
  }
});

// PUT /employer/job/:jobId/assign/:studentId
router.put("/:jobId/assign/:studentId", verifyToken, async (req, res) => {
  const { jobId, studentId } = req.params;
  const { uid, role } = req.user;

  if (role !== "employer")
    return res.status(403).send("Only employers can assign jobs");

  try {
    const jobDoc = await admin.firestore().doc(`jobs/${jobId}`).get();
    if (!jobDoc.exists) return res.status(404).send("Job not found");

    const studentDoc = await admin.firestore().doc(`users/${studentId}`).get();
    if (!studentDoc.exists || studentDoc.data().role !== "student") {
      return res.status(404).send("Student not found");
    }

    //await jobDoc.ref.update({ studentId, status: "assigned" });
    await jobDoc.ref.update({
      assignments: admin.firestore.FieldValue.arrayUnion({
        studentId,
        status: "assigned",
        timestamp: new Date().toISOString(),
      }),
    });

    res.status(200).send("Job assigned successfully");
  } catch (error) {
    console.error("Assignment error:", error.message);
    res.status(500).send("Failed to assign job");
  }
});

// PUT /employer/job/:jobId/verify
router.put("/:jobId/verify/:studentId", verifyToken, async (req, res) => {
  const { jobId, studentId } = req.params;
  const { uid, role } = req.user;

  if (role !== "employer")
    return res.status(403).send("Only employers can verify");

  try {
    const jobDoc = await admin.firestore().doc(`jobs/${jobId}`).get();
    if (!jobDoc.exists) return res.status(404).send("Job not found");

    const jobData = jobDoc.data();

    if (jobData.employerId !== uid) return res.status(403).send("Unauthorized");

    const assignments = jobData.assignments || [];

    const studentAssignment = assignments.find(
      (a) => a.studentId === studentId
    );

    if (!studentAssignment)
      return res.status(404).send("Assignment not found for student");
    if (studentAssignment.status !== "completed") {
      return res.status(400).send("Job is not yet completed by the student");
    }

    const updatedAssignments = assignments.map((a) =>
      a.studentId === studentId
        ? { ...a, status: "verified", timestamp: new Date().toISOString() }
        : a
    );

    await jobDoc.ref.update({ assignments: updatedAssignments });

    res.status(200).send("Job verified successfully");
  } catch (error) {
    console.error("Verify error:", error.message);
    res.status(500).send("Failed to verify job");
  }
});

// PUT /student/job/:jobId/accept
router.put("/:jobId/accept", verifyToken, async (req, res) => {
  const { jobId } = req.params;
  const { uid, role } = req.user;

  if (role !== "student")
    return res.status(403).send("Only students can accept jobs");

  try {
    const jobDoc = await admin.firestore().doc(`jobs/${jobId}`).get();
    if (!jobDoc.exists) return res.status(404).send("Job not found");

    const jobData = jobDoc.data();
    const assignments = jobData.assignments || [];

    const studentIds = assignments.map((a) => a.studentId);
    if (!studentIds.includes(uid)) {
      return res.status(403).send("Not your assigned job");
    }
    // if (jobDoc.data().studentId !== uid) {
    //   return res.status(403).send("Not your assigned job");
    // }

    //await jobDoc.ref.update({ status: "accepted" });

    const updatedAssignments = assignments.map((a) =>
      a.studentId === uid && a.status === "assigned"
        ? { ...a, status: "accepted", timestamp: new Date().toISOString() }
        : a
    );

    await jobDoc.ref.update({ assignments: updatedAssignments });

    res.status(200).send("Job accepted");
  } catch (error) {
    console.error("Accept error:", error.message);
    res.status(500).send("Failed to accept job");
  }
});

// PUT /student/job/:jobId/reject
router.put("/:jobId/reject", verifyToken, async (req, res) => {
  const { jobId } = req.params;
  const { uid, role } = req.user;

  if (role !== "student")
    return res.status(403).send("Only students can reject jobs");

  try {
    const jobDoc = await admin.firestore().doc(`jobs/${jobId}`).get();
    if (!jobDoc.exists) return res.status(404).send("Job not found");

    const jobData_reject = jobDoc.data();
    const assignments_reject = jobData_reject.assignments || [];

    const studentIds = assignments_reject.map((a) => a.studentId);
    if (!studentIds.includes(uid)) {
      return res.status(403).send("Not your assigned job");
    }

    /*
      if (jobDoc.data().studentId !== uid) {
        return res.status(403).send("Not your assigned job");
      }

      //await jobDoc.ref.update({ status: "rejected" });
    */

    const jobData = jobDoc.data();
    const assignments = jobData.assignments || [];

    const updatedAssignments = assignments.map((a) =>
      a.studentId === uid && a.status === "assigned"
        ? { ...a, status: "rejected", timestamp: new Date().toISOString() }
        : a
    );

    await jobDoc.ref.update({ assignments: updatedAssignments });

    res.status(200).send("Job rejected");
  } catch (error) {
    console.error("Reject error:", error.message);
    res.status(500).send("Failed to reject job");
  }
});

// PUT /student/job/:jobId/complete
router.put("/:jobId/complete", verifyToken, async (req, res) => {
  const { jobId } = req.params;
  const { uid, role } = req.user;

  if (role !== "student")
    return res.status(403).send("Only students can complete jobs");

  try {
    const jobDoc = await admin.firestore().doc(`jobs/${jobId}`).get();
    if (!jobDoc.exists) return res.status(404).send("Job not found");

    const jobData_complete = jobDoc.data();
    const assignments_complete = jobData_complete.assignments || [];

    const studentIds = assignments_complete.map((a) => a.studentId);
    if (!studentIds.includes(uid)) {
      return res.status(403).send("Not your assigned job");
    }

    // if (jobDoc.data().studentId !== uid) {
    //   return res.status(403).send("Not your assigned job");
    // }

    //await jobDoc.ref.update({ status: "completed" });

    const jobData = jobDoc.data();
    const assignments = jobData.assignments || [];

    const updatedAssignments = assignments.map((a) =>
      a.studentId === uid && a.status === "accepted"
        ? { ...a, status: "completed", timestamp: new Date().toISOString() }
        : a
    );

    await jobDoc.ref.update({ assignments: updatedAssignments });
    res.status(200).send("Job marked as completed");
  } catch (error) {
    console.error("Complete error:", error.message);
    res.status(500).send("Failed to complete job");
  }
});

// DELETE /job/:jobId
router.delete("/:jobId", verifyToken, async (req, res) => {
  const { jobId } = req.params;
  const { uid, role } = req.user;

  if (role !== "employer")
    return res.status(403).send("Only employers can delete jobs");

  try {
    const jobRef = admin.firestore().doc(`jobs/${jobId}`);
    const jobDoc = await jobRef.get();

    if (!jobDoc.exists) return res.status(404).send("Job not found");

    const job = jobDoc.data();

    if (job.employerId !== uid) return res.status(403).send("Unauthorized");

    if (Array.isArray(job.assignments) && job.assignments.length > 0) {
      return res
        .status(400)
        .send("Job cannot be deleted because it has assigned students.");
    }

    await jobRef.delete();
    res.status(200).send("Job deleted successfully");
  } catch (error) {
    console.error("Error deleting job:", error.message);
    res.status(500).send("Failed to delete job");
  }
});

export default router;
