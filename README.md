# Jawai Rajat – Hotel Booking Website

A single-page booking website for **Jawai Rajat** with a Node.js backend that saves booking requests to a JSON file.

## What’s included

- **Frontend:** Hero, Rooms & Event Stays, Events, Experiences, Gallery, Booking form, Contact.
- **Backend:** Express server that serves the site and provides booking APIs.
- **Storage:** Bookings are stored in `data/bookings.json`. Quick checks (hero form) are stored in `data/quick-checks.json`.

## Running the site (with backend)

1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the server:
   ```bash
   npm start
   ```
3. Open **http://localhost:3000** in your browser.

The booking form will submit to the server and new entries will appear in `data/bookings.json`.

## API (for your reference)

| Method | Endpoint          | Description                          |
|--------|-------------------|--------------------------------------|
| POST   | `/api/booking`    | Submit full booking request (JSON)   |
| POST   | `/api/quick-check`| Submit quick check-in/out + guests  |
| GET    | `/api/bookings`   | List all saved bookings (no auth)   |

**Note:** In production, protect `/api/bookings` (e.g. auth or remove) and consider adding email notifications.

## Viewing saved bookings

- Open `data/bookings.json` in a text editor, or
- Visit `http://localhost:3000/api/bookings` in the browser (returns JSON).

## Running without backend

If you open `index.html` directly (double-click or file://), the form will show an error when submitted because there is no server. Always use `npm start` and open http://localhost:3000 when you want bookings to be saved.
