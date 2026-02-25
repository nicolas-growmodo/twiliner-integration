require('dotenv').config();
const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

// Services
const Brevo = require('./services/brevo');
const Transform = require('./services/transform');
const Poller = require('./services/poller');

app.use(express.json());

// Start the Polling Worker
const pollingInterval = parseInt(process.env.POLLING_INTERVAL_MINUTES) || 5;
Poller.start(pollingInterval);

// Webhook Endpoint (Keeping for backward compatibility)
app.post('/webhook/turnit', async (req, res) => {
    const payload = req.body;

    try {
        if (payload.event_type === 'booking.created' || payload.event_type === 'booking.updated') {
            const reservation = payload.reservation;

            if (!reservation) {
                console.warn('Received webhook with no reservation data');
                return res.status(200).send('OK');
            }

            // reuse shared transformation logic
            // Note: Transform expects the wrapper-like structure slightly differently or pure reservation? 
            // Our transform function expects object WITH .legs, so we pass reservation directly.
            // But we need to construct the standard output that our sync expects.

            // Re-wrapping slightly to match Transform signature { legs: ... } which is the reservation object itself
            const data = Transform.transformTurnitReservation(reservation);

            if (!data) {
                console.warn('Transformation failed for webhook payload');
                return res.status(200).send('OK');
            }

            // Sync Logic
            if (data.booking.status === 'confirmed') {
                const brevoPayload = {
                    email: data.customer.email,
                    attributes: {
                        FIRSTNAME: data.customer.firstName,
                        LASTNAME: data.customer.lastName,
                        SMS: data.customer.phone,
                        BOOKING_REF: data.booking.reference,
                        DEPARTURE_DATE: data.booking.departureDate,
                        ARRIVAL_DATE: data.booking.arrivalDate,
                        PRE_TRAVEL_DATE: data.booking.preTravelDate,
                        POST_TRAVEL_DATE: data.booking.postTravelDate,
                        PAYMENT_STATUS: data.booking.status
                    },
                    updateEnabled: true
                };

                console.log(`[Webhook] Processing Confirmed Booking for: ${data.customer.email}`);
                await Brevo.syncContactToBrevo(brevoPayload);

            } else if (['pending', 'failed'].includes(data.booking.status)) {
                console.warn(`[Webhook] Potential Abandoned Cart. Booking Ref: ${data.booking.reference}`);

                const eventPayload = {
                    event_name: 'cart_updated',
                    identifiers: {
                        email_id: data.customer.email
                    },
                    event_properties: {
                        id: data.booking.reference,
                        price: data.booking.totalPrice,
                        currency: data.booking.currency,
                        status: data.booking.status,
                        departure_date: data.booking.departureDate,
                        origin: data.booking.origin,
                        destination: data.booking.destination
                    }
                };

                await Brevo.trackEventInBrevo(eventPayload);
            } else {
                console.log(`[Webhook] Received booking with status: ${data.booking.status}. No action taken.`);
            }
        } else {
            console.log(`Received event type: ${payload.event_type}. No action required.`);
        }

    } catch (error) {
        console.error('Error processing webhook:', error);
    }

    res.status(200).send('OK');
});

app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
    console.log(`Polling worker started with ${pollingInterval} minute interval.`);
});
