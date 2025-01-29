// Import required modules
const express = require('express');
const bodyParser = require('body-parser');
const xlsx = require('xlsx');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2');
const bcrypt = require('bcrypt');
const dotenv = require('dotenv');
const { body, validationResult } = require('express-validator');
const moment = require('moment'); // Import moment for date formatting

// Load environment variables from .env file
dotenv.config();

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Connect to MySQL Database
const db = mysql.createConnection({
    host: "localhost",
    user: "root",
    password: "1234",
    database: "hospital_management"
});

// Check database connection
db.connect((err) => {
    if (err) {
        console.error('Database connection failed: ', err.stack);
        return;
    }
    console.log('Connected to database.');
});

// Endpoint to get patients data with formatted date
app.get('/patients', (req, res) => {
    db.query('SELECT * FROM patients', (err, results) => {
        if (err) {
            return res.status(500).json({ error: 'Database query failed', details: err });
        }
        // Format date_of_birth for each patient
        const formattedResults = results.map(patient => ({
            ...patient,
            date_of_birth: moment(patient.date_of_birth).format('YYYY-MM-DD') // Format as needed
        }));
        res.json(formattedResults);
    });
});

// Endpoint to add a new patient with input validation
app.post('/patients', [
    body('first_name').notEmpty().withMessage('First name is required'),
    body('last_name').notEmpty().withMessage('Last name is required'),
    body('date_of_birth').isDate().withMessage('Valid date of birth is required'),
    body('gender').isIn(['Male', 'Female', 'Other']).withMessage('Gender is required'),
    body('contact').notEmpty().withMessage('Contact number is required'),
    body('address').notEmpty().withMessage('Address is required'),
    body('emergency_contact').notEmpty().withMessage('Emergency contact is required')
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { first_name, last_name, date_of_birth, gender, contact, address, emergency_contact } = req.body;
    
    // Format date_of_birth to ensure it's in the correct format for MySQL
    const formattedDateOfBirth = moment(date_of_birth).format('YYYY-MM-DD');

    const query = 'INSERT INTO patients (first_name, last_name, date_of_birth, gender, contact, address, emergency_contact) VALUES (?, ?, ?, ?, ?, ?, ?)';
    
    db.query(query, [first_name, last_name, formattedDateOfBirth, gender, contact, address, emergency_contact], (err, result) => {
        if (err) {
            return res.status(500).json({ error: 'Database query failed', details: err });
        }
        res.json({ message: 'Patient added successfully', patientId: result.insertId });
    });
});

// Endpoint to get doctors data
app.get('/doctors', (req, res) => {
    db.query('SELECT * FROM doctors', (err, results) => {
        if (err) {
            return res.status(500).json({ error: 'Database query failed', details: err });
        }
        res.json(results);
    });
});

// Endpoint to add a new doctor with input validation
app.post('/doctors', [
    body('first_name').notEmpty().withMessage('First name is required'),
    body('last_name').notEmpty().withMessage('Last name is required'),
    body('specialty').notEmpty().withMessage('Specialty is required'),
    body('contact').notEmpty().withMessage('Contact number is required'),
    body('email').isEmail().withMessage('Valid email is required')
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { first_name, last_name, specialty, contact, email } = req.body;
    const query = 'INSERT INTO doctors (first_name, last_name, specialty, contact, email) VALUES (?, ?, ?, ?, ?)';
    
    db.query(query, [first_name, last_name, specialty, contact, email], (err, result) => {
        if (err) {
            return res.status(500).json({ error: 'Database query failed', details: err });
        }
        res.json({ message: 'Doctor added successfully', doctorId: result.insertId });
    });
});

// Endpoint to get appointments data with patient and doctor names
app.get('/appointments', (req, res) => {
    const query = `
        SELECT 
            a.appointment_id,
            CONCAT(p.first_name, ' ', p.last_name) AS patient_name,
            CONCAT(d.first_name, ' ', d.last_name) AS doctor_name,
            a.appointment_date,
            a.appointment_time
        FROM 
            appointments a
        JOIN 
            patients p ON a.patient_id = p.patient_id
        JOIN 
            doctors d ON a.doctor_id = d.doctor_id;
    `;
    
    db.query(query, (err, results) => {
        if (err) {
            return res.status(500).json({ error: 'Database query failed', details: err });
        }
        res.json(results);
    });
});

// Path to the Excel file for storing user login details
const excelFilePath = path.join(__dirname, 'login_details.xlsx');

// Function to read user data from Excel
function readUsersFromExcel() {
    if (!fs.existsSync(excelFilePath)) {
        return [];
    }
    const workbook = xlsx.readFile(excelFilePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    return xlsx.utils.sheet_to_json(worksheet);
}

// Function to write new user data to Excel
function writeUserToExcel(username, password) {
    const users = readUsersFromExcel();
    users.push({ username, password });
    const newWorkbook = xlsx.utils.book_new();
    const newWorksheet = xlsx.utils.json_to_sheet(users);
    xlsx.utils.book_append_sheet(newWorkbook, newWorksheet, 'Users');
    xlsx.writeFile(newWorkbook, excelFilePath);
}

// Registration endpoint with password hashing
app.post('/register', [
    body('username').notEmpty().withMessage('Username is required'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters long')
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { username, password } = req.body;
    const users = readUsersFromExcel();

    // Check if the user already exists
    const existingUser = users.find(user => user.username === username);
    if (existingUser) {
        return res.status(400).json({ message: 'Username already exists.' });
    }

    // Hash the password and save the new user to Excel
    const hashedPassword = bcrypt.hashSync(password, 10);
    writeUserToExcel(username, hashedPassword);
    res.status(201).json({ message: 'User registered successfully!' });
});

// Login endpoint with password verification
app.post('/login', [
    body('username').notEmpty().withMessage('Username is required'),
    body('password').notEmpty().withMessage('Password is required')
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { username, password } = req.body;
    const users = readUsersFromExcel();

    // Check if the user exists
    const existingUser = users.find(user => user.username === username);

    if (existingUser) {
        // Compare the password with the hashed password
        if (bcrypt.compareSync(password, existingUser.password)) {
            return res.status(200).json({ message: 'Login successful!' });
        } else {
            return res.status(401).json({ message: 'Incorrect password!' });
        }
    } else {
        return res.status(404).json({ message: 'User not found!' });
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});