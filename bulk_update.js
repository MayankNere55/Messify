const fs = require('fs');
const path = require('path');

const studentsFile = path.join(__dirname, 'students.json');
const data = fs.readFileSync(studentsFile, 'utf8');
let students = JSON.parse(data);

const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD

function generateDateRange(startStr, endStr) {
    const start = new Date(startStr);
    const end = new Date(endStr);
    const dates = [];
    let current = new Date(start);
    while (current <= end) {
        dates.push(new Date(current).toLocaleDateString('en-CA'));
        current.setDate(current.getDate() + 1);
    }
    return dates;
}

const groupA_Rolls = [133, 29, 34, 41];
const groupB_Rolls = [10, 30, 40, 50, 60];

const groupA_Join = '2026-02-02';
const groupB_Join = '2026-01-01';

const groupA_Dates = generateDateRange(groupA_Join, today);
const groupB_Dates = generateDateRange(groupB_Join, today);

let updatedCount = 0;

students.forEach(student => {
    let updated = false;
    if (groupA_Rolls.includes(Number(student.roll))) {
        student.joinDate = groupA_Join;
        if (!student.attendance) student.attendance = {};
        groupA_Dates.forEach(date => {
            student.attendance[date] = "Present";
        });
        updated = true;
    } else if (groupB_Rolls.includes(Number(student.roll))) {
        student.joinDate = groupB_Join;
        if (!student.attendance) student.attendance = {};
        groupB_Dates.forEach(date => {
            student.attendance[date] = "Present";
        });
        updated = true;
    }

    if (updated) {
        // Also recalculate planExpiry: joinDate + 30 days
        const d = new Date(student.joinDate);
        d.setDate(d.getDate() + 30);
        
        // Add leave extension if any
        if (student.totalLeaveDays) {
            d.setDate(d.getDate() + student.totalLeaveDays);
        }
        
        student.planExpiry = d.toISOString().split('T')[0];
        updatedCount++;
    }
});

fs.writeFileSync(studentsFile, JSON.stringify(students, null, 2));
console.log(`✅ Bulk update complete! ${updatedCount} students updated.`);
