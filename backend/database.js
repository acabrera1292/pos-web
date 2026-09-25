const { AsyncLocalStorage } = require("async_hooks");

function createDatabase() {
  const postgres = Boolean(process.env.DATABASE_URL);
  if (!postgres) {
    const sqlite3 = require("sqlite3").verbose();
    const path = require("path");
    const filename = process.env.DATABASE_PATH || path.join(__dirname, "database.sqlite");
    const raw = new sqlite3.Database(filename);
    raw.serialize();
    return {
      postgres: false,
      raw,
      get(sql, params = []) {
        return new Promise((resolve, reject) => raw.get(sql, params, (err, row) => err ? reject(err) : resolve(row)));
      },
      all(sql, params = []) {
        return new Promise((resolve, reject) => raw.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows)));
      },
      run(sql, params = []) {
        return new Promise((resolve, reject) => raw.run(sql, params, function (err) {
          if (err) reject(err);
          else resolve({ lastID: this.lastID, changes: this.changes });
        }));
      },
      async transaction(work) {
        await this.run("BEGIN IMMEDIATE TRANSACTION");
        try {
          const result = await work();
          await this.run("COMMIT");
          return result;
        } catch (err) {
          try { await this.run("ROLLBACK"); } catch {}
          throw err;
        }
      }
    };
  }

  const { Pool } = require("pg");
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSL_DISABLE === "1" ? false : { rejectUnauthorized: false },
    max: Math.max(2, Number(process.env.PG_POOL_MAX) || 10)
  });
  const context = new AsyncLocalStorage();
  const idTables = new Set(["users", "password_reset_codes", "products", "sales", "invoices", "invoice_payments", "sale_adjustments", "client_intake_submissions", "clients", "restaurant_tables", "restaurant_servers", "restaurant_table_sessions", "restaurant_orders", "restaurant_order_items", "cash_register_sessions", "cash_register_movements", "suppliers", "purchases", "purchase_items"]);
  const camelKeys = {
    fullname: "fullName", mustchangepassword: "mustChangePassword", expiresat: "expiresAt", userlimit: "userLimit", usercount: "userCount",
    createdat: "createdAt", updatedat: "updatedAt", userid: "userId", codehash: "codeHash", usedat: "usedAt",
    taxrate: "taxRate", menucategory: "menuCategory", modifiergroups: "modifierGroups", productid: "productId", paymenttype: "paymentType", invoiceid: "invoiceId", supplierid: "supplierId", invoicenumber: "invoiceNumber", purchasedate: "purchaseDate", subtotal: "subtotal", unitcost: "unitCost", purchaseid: "purchaseId",
    grosstotal: "grossTotal", discountpercent: "discountPercent", discountamount: "discountAmount",
    discountreason: "discountReason", selectedmodifiers: "selectedModifiers", grantedbyuserid: "grantedByUserId", grantedbyname: "grantedByName",
    invoicetype: "invoiceType", clientid: "clientId", buyeridtype: "buyerIdType", buyeridnumber: "buyerIdNumber",
    buyername: "buyerName", buyeraddress: "buyerAddress", buyeremail: "buyerEmail", taxamount: "taxAmount",
    invoicenumber: "invoiceNumber", restaurantorderid: "restaurantOrderId", cashreceived: "cashReceived", changedue: "changeDue", issuedbyuserid: "issuedByUserId", issuedbyname: "issuedByName",
    accesskey: "accessKey", authorizationnumber: "authorizationNumber", authorizedat: "authorizedAt", srimessage: "sriMessage", legalname: "legalName", commercialname: "commercialName",
    mainaddress: "mainAddress", establishmentaddress: "establishmentAddress", establishmentcode: "establishmentCode",
    emissionpoint: "emissionPoint", nextsequence: "nextSequence", accountingrequired: "accountingRequired",
    specialtaxpayernumber: "specialTaxpayerNumber", taxregime: "taxRegime", senderemail: "senderEmail",
    admincopyemail: "adminCopyEmail", certificateconfigured: "certificateConfigured", certificatevalidated: "certificateValidated", certificatelocalvalidated: "certificateLocalValidated",
    businesstype: "businessType", tableid: "tableId", tablename: "tableName", sessionid: "sessionId", serveruserid: "serverUserId", restaurantserverid: "restaurantServerId",
    servername: "serverName", openedat: "openedAt", closedat: "closedAt", durationminutes: "durationMinutes", joinedtosessionid: "joinedToSessionId", joinedtablename: "joinedTableName",
    tablesessionid: "tableSessionId", orderid: "orderId", orderstatus: "orderStatus", itemid: "itemId", paidat: "paidAt", itemcount: "itemCount", orderitemcount: "orderItemCount",
    kitchenstatus: "kitchenStatus", kitchenreceivedat: "kitchenReceivedAt", kitchenstartedat: "kitchenStartedAt", kitchenreadyat: "kitchenReadyAt",
    passwordencrypted: "passwordEncrypted", certificateencrypted: "certificateEncrypted", installedat: "installedAt",
    tokenhash: "tokenHash", claimedat: "claimedAt", idtype: "idType", idnumber: "idNumber",
    razonsocial: "razonSocial", nombrecomercial: "nombreComercial",
    cashregistersessionid: "cashRegisterSessionId", openedbyuserid: "openedByUserId", openedbyname: "openedByName",
    openingamount: "openingAmount", closedbyuserid: "closedByUserId", closedbyname: "closedByName",
    cashsales: "cashSales", cardsales: "cardSales", transfersales: "transferSales", othersales: "otherSales",
    cashin: "cashIn", cashout: "cashOut", expectedamount: "expectedAmount", countedamount: "countedAmount",
    recordedbyuserid: "recordedByUserId", recordedbyname: "recordedByName",
    workdate: "workDate", checkin: "checkIn", checkout: "checkOut",
    regularhours: "regularHours", overtimehours: "overtimeHours", grosspay: "grossPay",
    paidbyuserid: "paidByUserId", paymentmode: "paymentMode", payrollactive: "payrollActive",
    hourlyrate: "hourlyRate", dailyminimum: "dailyMinimum", workdayhours: "workdayHours",
    overtimemultiplier: "overtimeMultiplier",
    returnedquantity: "returnedQuantity", returnedamount: "returnedAmount", salestatus: "saleStatus",
    invoicesalestatus: "invoiceSaleStatus", originalpaymenttype: "originalPaymentType", soldquantity: "soldQuantity",
    hascancellation: "hasCancellation",
    cancellationreason: "cancellationReason", canceledat: "canceledAt", canceledbyuserid: "canceledByUserId", canceledbyname: "canceledByName",
    performedbyuserid: "performedByUserId", performedbyname: "performedByName", adjustmentreason: "adjustmentReason", adjustmentbyname: "adjustmentByName"
  };

  function normalizeRow(row) {
    if (!row) return row;
    const normalized = {};
    for (const [key, value] of Object.entries(row)) normalized[camelKeys[key] || key] = value;
    return normalized;
  }

  function pgSql(sql) {
    let index = 0;
    return String(sql).replace(/\?/g, () => `$${++index}`);
  }

  function executor() {
    return context.getStore() || pool;
  }

  return {
    postgres: true,
    raw: pool,
    async get(sql, params = []) {
      const result = await executor().query(pgSql(sql), params);
      return normalizeRow(result.rows[0]);
    },
    async all(sql, params = []) {
      const result = await executor().query(pgSql(sql), params);
      return result.rows.map(normalizeRow);
    },
    async run(sql, params = []) {
      let statement = String(sql).trim();
      const insert = statement.match(/^INSERT\s+INTO\s+([a-zA-Z_][a-zA-Z0-9_]*)/i);
      if (insert && idTables.has(insert[1].toLowerCase()) && !/\bRETURNING\b/i.test(statement)) statement += " RETURNING id";
      const result = await executor().query(pgSql(statement), params);
      return { lastID: result.rows?.[0]?.id, changes: result.rowCount || 0 };
    },
    async transaction(work) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await context.run(client, work);
        await client.query("COMMIT");
        return result;
      } catch (err) {
        try { await client.query("ROLLBACK"); } catch {}
        throw err;
      } finally {
        client.release();
      }
    },
    async close() { await pool.end(); }
  };
}

module.exports = { createDatabase };
