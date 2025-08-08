Meter Reading Management API
A Node.js RESTful API for managing buildings, tenants, stalls, meters, meter readings, QR assignments, users, and utility rates in a market/building scenario. It supports JWT-based authentication and role-based authorization.


Features
JWT authentication (login required)

Role-based authorization (admin, employee)

CRUD for:

Buildings

Utility Rates

Tenants

Stalls

Meters

QR Codes

Meter Readings

Users

Dependency checks before deletes

Proper data validation and error handling

Requirements
Node.js (v18+ recommended)

MySQL/MariaDB server

npm


Setup Guide

Clone the repo

Install dependencies

npm install express sequelize mysql2 bcrypt dotenv jsonwebtoken


Create a .env file (adjust values for your own setup)

DB_HOST=yourdb_hostname
DB_PORT=yourdb_port
DB_NAME=yourdb_name
DB_USER=your_mysql_user
DB_PASSWORD=your_mysql_password
JWT_SECRET=your_very_long_secret
JWT_EXPIRES_IN=1h

To run the app 
npm start

For auto reload using nodemon
npm run dev 


API Endpoints Overview
All endpoints require a valid JWT Bearer token in the Authorization header.

Authentication
POST /auth/login — login with { user_id, user_password } (returns JWT)auth.

Users (/users)
GET /users — list all users 

POST /users — create user 

PUT /users/:id — update user 

DELETE /users/:id — delete user 

Buildings (/buildings)
GET /buildings — list buildings

POST /buildings — create building 

PUT /buildings/:id — update building 

DELETE /buildings/:id — delete building 

Utility Rates (/rates)
GET /rates — list all rates

POST /rates — create rate

PUT /rates/:id — update rate

DELETE /rates/:id — delete rate 

Tenants (/tenants)
GET /tenants — list tenants

POST /tenants — create tenant

PUT /tenants/:id — update tenant

DELETE /tenants/:id — delete tenant 

Stalls (/stalls)
GET /stalls — list stalls

POST /stalls — create stall

PUT /stalls/:id — update stall

DELETE /stalls/:id — delete stall 

Meters (/meters)
GET /meters — list meters

POST /meters — create meter

PUT /meters/:id — update meter

DELETE /meters/:id — delete meter 
Meter Readings (/readings)
GET /readings — list readings

POST /readings — create reading

PUT /readings/:id — update reading

DELETE /readings/:id — delete meter_readings

QR Codes (/qrs)
GET /qrs — list QR details

POST /qrs — create QR

PUT /qrs/:id — update QR

DELETE /qrs/:id — delete QR 