const sql = require("mssql/msnodesqlv8");
require("dotenv").config();

const driver = "ODBC Driver 17 for SQL Server"; 

const connectionString = `
Driver={${driver}};
Server=localhost\\SQLEXPRESS;
Database=${process.env.SQL_DATABASE};
UID=${process.env.SQL_USER};
PWD=${process.env.SQL_PASSWORD};
Trusted_Connection=No;
Encrypt=No;
`;

const poolPromise = new sql.ConnectionPool({
  connectionString,
  options: {
    trustServerCertificate: true
  }
})
  .connect()
  .then(pool => {
    console.log("✅ Connected to SQL Server (ODBC local driver)");
    return pool;
  })
  .catch(err => console.error("❌ DB Connection Failed:", err));

module.exports = { sql, poolPromise };
