# Brevo and Turnit Integration

## Overview

This project provides an automated synchronization pipeline between the **Turnit API** (a booking system) and **Brevo** (CRM/Marketing). It periodically polls Turnit for newly created or modified bookings, transforms the complex nested booking data into a flat schema, and automatically syncs the customer data (and trip details) to Brevo.

### Core Behaviors

*   **Confirmed Bookings:** Sent to Brevo as **Contacts** with custom attributes (e.g., `FIRSTNAME`, `DEPARTURE_DATE`, `BOOKING_REF`).
*   **Pending/Failed Bookings:** Sent to Brevo as **Tracked Events** (e.g., `cart_updated`) to enable cart abandonment workflows.
*   **Incremental Sync:** Uses a local state file (`last_sync.json`) to remember the timestamp of the last successful sync, retrieving only new data in the next cycle.

---

## Architecture

The project is structured modularly within the `services/` directory:

*   **`turnit.js`**: Handles authentication (Client Credentials flow), fetches booking summaries using the `POST /bookings-search` endpoint, and retrieves full booking JSONs using the `GET /bookings/{id}` endpoint. It automatically handles the specialized `Requestor` base64-encoded JSON header.
*   **`transform.js`**: Parses Turnit's JSON responses (specifically handling `tripSummaries` arrays, calculating pre/post travel dates, and extracting `purchaser.detail`). Outputs a standardized Javascript object.
*   **`brevo.js`**: Wraps the Brevo API implementation. Exposes `syncContactToBrevo` for upserting contacts and `trackEventInBrevo` for behavioral tracking.
*   **`poller.js`**: The main orchestration worker. Runs on a continuous loop, piping data from Turnit → Transform → Brevo, and updating the state upon successful completion.
*   **`state.js`**: A simple persistence layer managing `last_sync.json`. Let's the app resume safely after restarts.

---

## Setup & Execution

### 1. Installation

Ensure you have Node.js installed, then install the dependencies:

```bash
npm install
```

### 2. Configuration

Create or update the `.env` file in the root directory. Required variables:

```env
# Brevo API Configuration
BREVO_API_KEY=your_brevo_v3_api_key

# Express Server Port (optional, defaults to 3000)
PORT=3000

# Turnit API Configuration
TURNIT_API_URL=https://api.prelive.twiliner.turnit.tech/retailer
TURNIT_AUTH_ID=your_turnit_client_id
TURNIT_AUTH_SECRET=your_turnit_client_secret
TURNIT_POS_ID=1 # The PointOfSaleID required by the API for the Requestor Header

# Sync Interval in minutes
POLLING_INTERVAL_MINUTES=5
```

### 3. Running the Poller

To start the main application (which runs the server and initiates the background polling):

```bash
node index.js
```

---

## Diagnostic & Testing Scripts

During development and when debugging connection issues, several standalone scripts are available to quickly diagnose problems without running the full sync cycle:

*   **`test_turnit_real.js`**: Searches for bookings created in the last 30 days and logs the customer names found. Useful for verifying Turnit Authentication and Search capabilities.
*   **`test_brevo_connection.js`**: Safely tests the `BREVO_API_KEY` by querying the `/account` endpoint without writing or manipulating any contact data. Essential for verifying IP whitelisting or key validity.
*   **`test_integration.js`**: An end-to-end test for a hardcoded, known booking ID. It fetches the booking from Turnit, runs it through the transformer, and prints the payload that *would* be sent to Brevo.
*   **`probe_get.js` & `probe_info.js`**: Utility scripts used to decipher undocumented or vague API error responses (such as missing request headers or invalid POS IDs).

---

## Deployment

Since this project runs a continuous background poller (and an optional Express server for webhooks on port 3000), it needs to be deployed to an environment that supports long-running Node.js processes.

### Option 1: VPS (DigitalOcean, AWS EC2, Linode) using PM2 (Recommended)

This is the most standard way to run a Node.js worker reliably.

1.  **Server Setup**: Provision a Linux server and install Node.js and npm.
2.  **Clone the Project**: Transfer or clone this repository to the server.
3.  **Install PM2**: Install PM2 globally to manage the process.
    ```bash
    npm install -g pm2
    ```
4.  **Install Dependencies**: Inside the project folder, run `npm install`.
5.  **Configure Environment**: Create the `.env` file on the server with your production credentials.
6.  **Start the App**: Start the project with PM2, which will automatically restart it if it crashes.
    ```bash
    pm2 start index.js --name "turnit-brevo-sync"
    ```
7.  **Auto-Restart on Reboot**: Tell PM2 to start on server boot.
    ```bash
    pm2 startup
    pm2 save
    ```

### Option 2: Platform as a Service (PaaS - Render / Heroku / Railway)

If you prefer to not manage a server directly, a PaaS is an excellent choice.

1.  **Connect Repo**: Push your code to a Git repository (GitHub/GitLab) and connect it to Render, Heroku, or Railway.
2.  **Configure Service**: Set it up as a "Web Service" (since it binds to a PORT via Express) or a "Background Worker".
3.  **Environment Variables**: Input all your `.env` variables directly into the service's dashboard settings.
4.  **Deploy**: The platform will automatically run `npm install` and start the app using `node index.js`.

**Note on File Storage:** This app currently uses a local `last_sync.json` file to store the timestamp of the last successful run. On ephemeral systems (like Heroku), the local file system resets on every deploy. If deploying to an ephemeral PaaS, consider swapping the `services/state.js` logic to use a simple database (like Redis, MongoDB, or an external cloud file storage) if you don't want the sync interval to reset on deployment. On a VPS or persistent disk (Render with disks), the local file is perfectly fine.
