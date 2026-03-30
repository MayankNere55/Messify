const express = require('express');
const fs = require('fs');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = 3000;

// Middleware to parse incoming requests and allow cross-origin
app.use(cors());
app.use(express.json()); 
app.use(express.urlencoded({ extended: true })); 

// Serve static frontend files (HTML, CSS, JS, images) natively
app.use(express.static(path.join(__dirname)));

// File paths to store data locally
const studentsFile = path.join(__dirname, 'students.json');
const feedbackFile = path.join(__dirname, 'feedback.json');

// Initialize empty JSON files if they don't exist yet
if (!fs.existsSync(studentsFile)) fs.writeFileSync(studentsFile, JSON.stringify([]));
if (!fs.existsSync(feedbackFile)) fs.writeFileSync(feedbackFile, JSON.stringify([]));

// Helper to automatically mark attendance based on current date and leave history
function autoMarkAttendance(students) {
    let updated = false;
    // Get local date in YYYY-MM-DD format (matches the date format used in students.json)
    const today = new Date().toLocaleDateString('en-CA'); 

    students.forEach(student => {
        if (!student.attendance) student.attendance = {};

        // Only auto-mark if not already set for today (respects manual admin overrides)
        if (!student.attendance[today]) {
            let status = 'Present'; // Default for all students

            // Check if student has an approved leave for today
            if (student.leaveHistory && student.leaveHistory.length > 0) {
                const onLeaveToday = student.leaveHistory.find(leave => {
                    if (leave.status !== 'Approved') return false;
                    
                    // Parse dates for comparison
                    const leaveStart = new Date(leave.startDate);
                    const leaveEnd = new Date(leave.endDate);
                    const currentDate = new Date(today);
                    
                    // Set all to midnight for accurate comparison
                    leaveStart.setHours(0,0,0,0);
                    leaveEnd.setHours(0,0,0,0);
                    currentDate.setHours(0,0,0,0);

                    return currentDate >= leaveStart && currentDate <= leaveEnd;
                });

                if (onLeaveToday) {
                    status = 'Absent';
                    // Optional: console.log(`📡 Auto-marking ${student.name} as Absent (On Approved Leave).`);
                }
            }

            student.attendance[today] = status;
            updated = true;
        }
    });

    return updated;
}

// Helper function to check and reset student billing if 30 days have passed

// Helper function to process payments, cycles, and data migration
function processPaymentsAndCycles(students) {
    let updated = false;
    const now = new Date();
    const todayStr = now.toLocaleDateString('en-CA');

    students.forEach(student => {
        // 1. Data Migration & Initialization
        if (!student.payments) student.payments = [];
        
        // Migrate old flat fields into the payments array for Cycle 1
        if (student.paymentStatus === 'Paid' && student.payments.length === 0) {
            student.payments.push({
                cycle: 1,
                amount: 3000, // Default assume base
                status: 'Paid',
                paidAt: student.paymentDate || todayStr,
                txnId: student.txnId || 'LEGACY-' + Date.now()
            });
            updated = true;
        }

        // 2. Cycle Calculations
        if (student.joinDate) {
            const join = new Date(student.joinDate);
            const actualDaysSinceJoin = Math.max(0, Math.ceil((now - join) / (1000 * 60 * 60 * 24)));
            const totalLeave = student.totalLeaveDays || 0;
            const effectiveDays = Math.max(0, actualDaysSinceJoin - totalLeave);
            
            student.totalDaysCompleted = actualDaysSinceJoin;
            student.effectiveDays = effectiveDays;
            
            // Current cycle is 1-30 = 1, 31-60 = 2, etc.
            student.currentCycle = Math.ceil((effectiveDays + 1) / 30);
            
            // Check if latest cycle is paid
            const latestCyclePaid = student.payments.some(p => p.cycle === student.currentCycle && p.status === 'Paid');
            
            // Logic for status display (simple version for existing dashboard compatibility)
            if (latestCyclePaid) {
                student.paymentStatus = 'Paid';
            } else {
                // Check if already submitted proof for this cycle
                const proofExists = student.paymentStatus === 'Pending Approval';
                if (!proofExists) {
                    student.paymentStatus = 'Pending';
                }
            }
        }
    });
    
    // Auto-mark daily attendance
    if (autoMarkAttendance(students)) updated = true;

    if (updated) {
        fs.writeFileSync(studentsFile, JSON.stringify(students, null, 2));
    }
    return students;
}

/**
 * 🏠 GET / - Serves the main Mess Portal page natively
 */
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'Mess.html'));
});

/**
 * 📝 POST /register - Handles new student registrations
 */
app.post('/register', (req, res) => {
    const newStudent = req.body; // Expecting { name, phone, branch, gender, messType, tiffinDelivery, deliveryAddress, billingMonth, totalCalculatedFee, password }
    
    const data = fs.readFileSync(studentsFile, 'utf8');
    const students = JSON.parse(data || "[]");
    
    newStudent.roll = students.length + 1;
    newStudent.id = "STU-" + Date.now();
    const firstName = newStudent.name ? newStudent.name.split(' ')[0] : 'Student';
    newStudent.loginId = firstName;
    
    if (!newStudent.password) {
        newStudent.password = firstName + "@1234";
    }
    
    newStudent.registrationDate = new Date().toLocaleString();
    
    // Messify Subscription Logic
    const now = new Date();
    newStudent.joinDate = now.toISOString().split('T')[0]; // YYYY-MM-DD
    
    // Default 30 days subscription
    const expiry = new Date();
    expiry.setDate(now.getDate() + 30);
    newStudent.planExpiry = expiry.toISOString().split('T')[0];
    
    newStudent.totalLeaveDays = 0;
    newStudent.leaveHistory = [];
    
    students.push(newStudent);
    fs.writeFileSync(studentsFile, JSON.stringify(students, null, 2));
    
    console.log(`🎉 New student registered: ${newStudent.name} (Roll No: ${newStudent.roll})`);
    res.status(201).json({ 
        message: 'Registration successful!', 
        student: newStudent,
        loginId: newStudent.loginId,
        password: newStudent.password,
        roll: newStudent.roll
    });
});

/**
 * 🔢 GET /next-roll - Returns the next available sequential roll number
 */
app.get('/next-roll', (req, res) => {
    const data = fs.readFileSync(studentsFile, 'utf8');
    const students = JSON.parse(data || "[]");
    res.status(200).json({ nextRoll: students.length + 1 });
});

/**
 * 🔄 POST /reassign-rolls - Renumbers all students sequentially by registration order
 */
app.post('/reassign-rolls', (req, res) => {
    const data = fs.readFileSync(studentsFile, 'utf8');
    let students = JSON.parse(data || "[]");
    students = students.map((s, i) => ({ ...s, roll: i + 1 }));
    fs.writeFileSync(studentsFile, JSON.stringify(students, null, 2));
    console.log("🔄 Roll numbers reassigned for all students.");
    res.status(200).json({ message: 'Roll numbers reassigned successfully!', students });
});

/**
 * 🔐 POST /login - Handles student login
 */
app.post('/login', (req, res) => {
    const { loginId, password } = req.body;
    
    const data = fs.readFileSync(studentsFile, 'utf8');
    let students = JSON.parse(data || "[]");
    
    // Auto-update billing states for all students
    students = processPaymentsAndCycles(students);
    
    // Check for management login
    if (loginId === 'RAM' && password === 'Mess@1234') {
        return res.status(200).json({ message: 'Admin login successful', role: 'admin', students });
    }

    const student = students.find(s => s.loginId === loginId && s.password === password);
    
    if (student) {
        res.status(200).json({ message: 'Login successful', role: 'student', student });
    } else {
        res.status(401).json({ message: 'Invalid Login ID or Password' });
    }
});

/**
 * 📊 GET /students - Returns the full list of students for Admin Dashboard
 */
app.get('/students', (req, res) => {
    const data = fs.readFileSync(studentsFile, 'utf8');
    let students = JSON.parse(data || "[]");
    
    // Auto-update billing states before passing to admin
    students = processPaymentsAndCycles(students);
    
    res.status(200).json(students);
});

/**
 * 🎓 GET /student/:id - Returns a single student's fresh data with auto-attendance applied
 * Used by the student dashboard on load to always get up-to-date attendance.
 */
app.get('/student/:id', (req, res) => {
    const { id } = req.params;
    const data = fs.readFileSync(studentsFile, 'utf8');
    let students = JSON.parse(data || "[]");

    // Run auto-attendance + payment/cycle processing for all students
    students = processPaymentsAndCycles(students);

    const student = students.find(s => s.id === id);
    if (!student) {
        return res.status(404).json({ message: 'Student not found.' });
    }
    res.status(200).json(student);
});

/**
 * ✏️ POST /update-student - Admin updates student info
 */
app.post('/update-student', (req, res) => {
    const updatedStudent = req.body;
    
    const data = fs.readFileSync(studentsFile, 'utf8');
    let students = JSON.parse(data || "[]");
    
    const index = students.findIndex(s => s.id === updatedStudent.id);
    if (index !== -1) {
        // Overwrite updated values
        students[index] = { ...students[index], ...updatedStudent };
        fs.writeFileSync(studentsFile, JSON.stringify(students, null, 2));
        
        // Return full list to refresh frontend admin dashboard
        res.status(200).json({ message: 'Student successfully updated!', students });
    } else {
        res.status(404).json({ message: 'Student not found.' });
    }
});

/**
 * 📸 POST /submit-payment-proof - Student submits payment screenshot
 */
app.post('/submit-payment-proof', (req, res) => {
    const { id, paymentProof, cycle } = req.body;

    const data = fs.readFileSync(studentsFile, 'utf8');
    let students = JSON.parse(data || "[]");

    const index = students.findIndex(s => s.id === id);
    if (index !== -1) {
        // Record intent to pay for a specific cycle
        students[index].pendingCycle = cycle || students[index].currentCycle || 1;
        students[index].paymentStatus = 'Pending Approval';
        students[index].paymentProof = paymentProof; // base64 data URL
        students[index].proofSubmittedAt = new Date().toLocaleString();
        
        fs.writeFileSync(studentsFile, JSON.stringify(students, null, 2));
        console.log(`📸 Payment proof submitted by ${students[index].name} for Cycle ${students[index].pendingCycle}`);
        res.status(200).json({ message: 'Proof submitted! Awaiting admin approval.', student: students[index] });
    } else {
        res.status(404).json({ message: 'Student not found.' });
    }
});

/**
 * ✅ POST /approve-payment - Admin approves a student's payment
 */
app.post('/approve-payment', (req, res) => {
    const { id } = req.body;

    const data = fs.readFileSync(studentsFile, 'utf8');
    let students = JSON.parse(data || "[]");

    const index = students.findIndex(s => s.id === id);
    if (index !== -1) {
        const student = students[index];
        const cycleToApprove = student.pendingCycle || student.currentCycle || 1;
        
        // Add to history
        if (!student.payments) student.payments = [];
        student.payments.push({
            cycle: cycleToApprove,
            amount: student.totalCalculatedFee || 3000,
            status: 'Paid',
            paidAt: new Date().toLocaleString(),
            txnId: 'TXN' + Math.floor(Math.random() * 1000000000)
        });

        student.paymentStatus = 'Paid';
        student.paymentProof = null;
        student.pendingCycle = null;
        
        fs.writeFileSync(studentsFile, JSON.stringify(students, null, 2));
        console.log(`✅ Payment approved for ${student.name} (Cycle ${cycleToApprove})`);
        res.status(200).json({ message: `Payment approved for Cycle ${cycleToApprove}!`, students });
    } else {
        res.status(404).json({ message: 'Student not found.' });
    }
});

/**
 * ❌ POST /reject-payment - Admin rejects a student's payment proof
 */
app.post('/reject-payment', (req, res) => {
    const { id, reason } = req.body;

    const data = fs.readFileSync(studentsFile, 'utf8');
    let students = JSON.parse(data || "[]");

    const index = students.findIndex(s => s.id === id);
    if (index !== -1) {
        students[index].paymentStatus = 'Rejected';
        students[index].rejectionReason = reason || 'Proof unclear. Please resubmit.';
        students[index].paymentProof = null;
        fs.writeFileSync(studentsFile, JSON.stringify(students, null, 2));
        console.log("❌ Payment rejected for:", students[index].name);
        res.status(200).json({ message: 'Payment rejected.', students });
    } else {
        res.status(404).json({ message: 'Student not found.' });
    }
});

/**
 * 🛫 POST /apply-leave - Handles student leave applications with strict validation
 */
app.post('/apply-leave', (req, res) => {
    const { id, startDate, endDate } = req.body;
    
    const data = fs.readFileSync(studentsFile, 'utf8');
    let students = JSON.parse(data || "[]");
    
    const index = students.findIndex(s => s.id === id);
    if (index === -1) return res.status(404).json({ message: 'Student not found.' });

    const student = students[index];
    const now = new Date();
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    // 1. Validation: Must apply before leave start date
    // Set 'now' to midnight for fair comparison
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (start <= today) {
        return res.status(400).json({ 
            message: 'Leave must be applied at least one day before the start date.',
            status: 'Rejected'
        });
    }

    // 2. Validation: Continuous and at least 5 days
    const diffTime = Math.abs(end - start);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;

    if (diffDays < 5) {
        return res.status(400).json({ 
            message: 'Leave must be for a continuous period of at least 5 days.',
            status: 'Rejected' 
        });
    }

    // 3. Approval & Extension Logic
    const leaveEntry = {
        startDate,
        endDate,
        appliedAt: new Date().toLocaleString(),
        days: diffDays,
        status: 'Approved'
    };

    // Update Student Record
    if (!student.leaveHistory) student.leaveHistory = [];
    student.leaveHistory.push(leaveEntry);
    student.totalLeaveDays = (student.totalLeaveDays || 0) + diffDays;

    // Extend Expiry Date
    let currentExpiry;
    if (student.planExpiry) {
        currentExpiry = new Date(student.planExpiry);
    } else {
        // Fallback if somehow missing
        currentExpiry = new Date(student.joinDate || now);
        currentExpiry.setDate(currentExpiry.getDate() + 30);
    }
    
    if (isNaN(currentExpiry.getTime())) {
        currentExpiry = today; // Last fallback
    }

    currentExpiry.setDate(currentExpiry.getDate() + diffDays);
    student.planExpiry = currentExpiry.toISOString().split('T')[0];

    fs.writeFileSync(studentsFile, JSON.stringify(students, null, 2));

    console.log(`✅ Leave Approved for ${student.name}: ${diffDays} days added.`);
    res.status(200).json({ 
        message: 'Leave Approved! Plan expiry extended.', 
        student,
        extension: diffDays 
    });
});

/**
 * 💬 POST /feedback - Handles submitted student feedback
 */
app.post('/feedback', (req, res) => {
    const newFeedback = req.body;
    
    // Read current feedback
    const data = fs.readFileSync(feedbackFile, 'utf8');
    const feedbacks = JSON.parse(data || "[]");
    
    // Tag with a date
    newFeedback.date = new Date().toLocaleString();
    feedbacks.push(newFeedback);
    
    // Save the updated array back to feedback.json
    fs.writeFileSync(feedbackFile, JSON.stringify(feedbacks, null, 2));
    
    console.log("📨 New feedback received from:", newFeedback.fname || "Anonymous");
    res.status(201).json({ message: 'Feedback submitted successfully!' });
});

// Start the server
const server = app.listen(PORT, () => {
    console.log(`\n===========================================`);
    console.log(`🚀 Backend Server is ALIVE!`);
    console.log(`📡 Listening on http://localhost:${PORT}`);
    console.log(`📁 Saving data directly to 'students.json' and 'feedback.json'`);
    console.log(`===========================================\n`);
});

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`\n❌ ERROR: Port ${PORT} is already in use.`);
        console.error(`💡 Tips:`);
        console.error(`1. You may already have a 'node server.js' running in another terminal.`);
        console.error(`2. Close that terminal or stop the other process and try again.`);
        console.error(`===========================================\n`);
        process.exit(1);
    }
});
