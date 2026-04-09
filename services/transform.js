/**
 * Transforms a Turnit reservation object into the internal standard format
 * expected by the Brevo sync logic.
 * 
 * @param {Object} reservation - The reservation object from Turnit webhook or API.
 * @returns {Object|null} - Transformed data or null if invalid.
 */
function transformTurnitReservation(reservation) {
    if (!reservation) {
        console.warn('Transformation failed: No reservation data');
        return null;
    }

    // 2. Extract Data from Real API Structure
    // API returns 'purchaser' and 'tripSummaries', not 'customer' and 'legs'
    const purchaser = reservation.purchaser && reservation.purchaser.detail ? reservation.purchaser.detail : {};
    const trips = reservation.trips || [];
    let legs = [];

    // Flat map all legs from all trips if tripSummaries is missing
    if (reservation.tripSummaries) {
        legs = reservation.tripSummaries;
    } else if (trips.length > 0) {
        legs = trips[0].legs || [];
    }

    // We don't abort if no legs exist anymore, we just leave route data empty
    // so the contact can still be created in Brevo.

    const customerEmail = purchaser.email;
    const customerFirstName = purchaser.firstName;
    const customerLastName = purchaser.lastName;
    const customerPhone = purchaser.phoneNumber || purchaser.phone || ''; // Updated to support phoneNumber
    const bookingReference = reservation.id || reservation.bookingCode;
    const bookingCode = reservation.bookingCode || '';

    // Determine status roughly based on confirmed price or offers
    let paymentStatus = reservation.confirmedPrice && reservation.confirmedPrice.amount > 0 ? 'confirmed' : 'pending';
    
    // Check for refunded or cancelled status in bookedOffers or admissions
    if (reservation.bookedOffers && reservation.bookedOffers.length > 0) {
        const statuses = [];
        reservation.bookedOffers.forEach(o => {
            if (o.status) statuses.push(o.status);
            if (o.admissions && o.admissions.length > 0) {
                o.admissions.forEach(a => { if (a.status) statuses.push(a.status); });
            }
        });

        const allRefunded = statuses.length > 0 && statuses.every(s => s === 'REFUNDED');
        const allCancelled = statuses.length > 0 && statuses.every(s => s === 'CANCELLED');
        const allReleased = statuses.length > 0 && statuses.every(s => s === 'RELEASED');
        const anyRefunded = statuses.some(s => s === 'REFUNDED');
        const anyCancelled = statuses.some(s => s === 'CANCELLED');
        const anyReleased = statuses.some(s => s === 'RELEASED');

        if (allRefunded) {
            paymentStatus = 'refunded';
        } else if (allCancelled) {
            paymentStatus = 'cancelled';
        } else if (allReleased) {
            paymentStatus = 'released'; // Maps to RELEASED in Brevo
        } else if (anyRefunded || anyCancelled || anyReleased) {
            // Partially refunded/cancelled/released is still a significant state, default to confirmed if there's confirmed price
            if (reservation.confirmedPrice && reservation.confirmedPrice.amount === 0) {
                paymentStatus = anyRefunded ? 'refunded' : (anyCancelled ? 'cancelled' : 'released');
            }
        }
    } else if (reservation.status) {
        // Fallback to root status if returned directly
        if (reservation.status === 'REFUNDED' || reservation.status === 'CANCELLED') {
            paymentStatus = reservation.status.toLowerCase();
        }
    }

    let departureDateStr = '';
    let arrivalDateStr = '';
    let origin = 'Unknown';
    let destination = 'Unknown';

    if (legs.length > 0) {
        const firstLeg = legs[0];
        const lastLeg = legs[legs.length - 1];

        // Handle extraction depending on whether we got tripSummaries or full trips.legs
        if (firstLeg.startTime) {
            // Fallback for older mock format
            departureDateStr = firstLeg.startTime;
            arrivalDateStr = lastLeg.endTime;
            origin = firstLeg.origin && firstLeg.origin.stopPlaceRef ? firstLeg.origin.stopPlaceRef : 'Unknown';
            destination = lastLeg.destination && lastLeg.destination.stopPlaceRef ? lastLeg.destination.stopPlaceRef : 'Unknown';
        } else if (firstLeg.timedLeg) {
            // Real API format
            departureDateStr = firstLeg.timedLeg.start.serviceDeparture.timetabledTime;
            arrivalDateStr = lastLeg.timedLeg.end.serviceArrival.timetabledTime;
            origin = firstLeg.timedLeg.start.stopPlaceName || firstLeg.timedLeg.start.stopPlaceRef.stopPlaceRef;
            destination = lastLeg.timedLeg.end.stopPlaceName || lastLeg.timedLeg.end.stopPlaceRef.stopPlaceRef;
        }
    }

    // 3. Transform/Calculate Dates
    const departureDate = new Date(departureDateStr);
    const arrivalDate = new Date(arrivalDateStr);

    // Calculate Pre-Travel Date (3 days before Departure)
    const preTravelDate = new Date(departureDate);
    preTravelDate.setDate(departureDate.getDate() - 3);

    // Calculate Post-Travel Date (3 days after Arrival)
    const postTravelDate = new Date(arrivalDate);
    postTravelDate.setDate(arrivalDate.getDate() + 3);

    // Helper to format date as YYYY-MM-DD
    const formatDate = (date) => {
        if (isNaN(date.getTime())) return ''; // Avoid invalid date bugs
        return date.toISOString().split('T')[0];
    };

    const formattedPreTravelDate = formatDate(preTravelDate);
    const formattedPostTravelDate = formatDate(postTravelDate);
    const formattedDepartureDate = formatDate(departureDate);
    const formattedArrivalDate = formatDate(arrivalDate);

    // Extract exact time string to avoid UTC shifting
    const extractTime = (dateStr) => {
        if (!dateStr) return '';
        const match = dateStr.match(/T(\d{2}:\d{2})/);
        return match ? match[1] : '';
    };
    const departureTime = extractTime(departureDateStr);
    const arrivalTime = extractTime(arrivalDateStr);

    // Price
    const totalPrice = reservation.confirmedPrice ? reservation.confirmedPrice.amount / Math.pow(10, reservation.confirmedPrice.scale) : 0;
    const currency = reservation.confirmedPrice ? reservation.confirmedPrice.currency : 'EUR';

    // Get Ticket Number from fulfillments
    let ticketNumber = '';
    if (reservation.fulfillments && Array.isArray(reservation.fulfillments)) {
        ticketNumber = reservation.fulfillments.filter(f => f.controlNumber).map(f => f.controlNumber).join(', ');
    }

    // --- Extract Unique Contacts (Purchaser + Passengers) ---
    const contactsMap = new Map();

    // 1. Add purchaser
    if (purchaser.email) {
        contactsMap.set(purchaser.email.toLowerCase(), {
            email: purchaser.email,
            firstName: purchaser.firstName || '',
            lastName: purchaser.lastName || '',
            phone: purchaser.phoneNumber || purchaser.phone || ''
        });
    }

    // 2. Add passengers
    if (reservation.passengers && Array.isArray(reservation.passengers)) {
        reservation.passengers.forEach(p => {
            if (p.detail && p.detail.email) {
                const email = p.detail.email.toLowerCase();
                if (!contactsMap.has(email)) {
                    contactsMap.set(email, {
                        email: p.detail.email,
                        firstName: p.detail.firstName || '',
                        lastName: p.detail.lastName || '',
                        phone: p.detail.phoneNumber || p.detail.phone || ''
                    });
                }
            }
        });
    }

    const contacts = Array.from(contactsMap.values());
    const primaryCustomer = contacts.length > 0 ? contacts[0] : null;

    // Return standardized structure
    return {
        customer: primaryCustomer, // Kept for backwards compatibility
        contacts: contacts,        // Array of all unique passengers/purchaser
        booking: {
            reference: bookingReference,
            bookingCode: bookingCode,
            ticketNumber: ticketNumber, // Added ticket number
            status: paymentStatus,
            totalPrice: totalPrice,
            currency: currency,
            departureDate: formattedDepartureDate,
            departureTime: departureTime, // Added departure time
            arrivalDate: formattedArrivalDate,
            arrivalTime: arrivalTime, // Added arrival time
            preTravelDate: formattedPreTravelDate,
            postTravelDate: formattedPostTravelDate,
            origin: origin,
            destination: destination
        }
    };
}

module.exports = {
    transformTurnitReservation
};
