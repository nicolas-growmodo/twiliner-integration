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
    const paymentStatus = reservation.confirmedPrice && reservation.confirmedPrice.amount > 0 ? 'confirmed' : 'pending';

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

    // Price
    const totalPrice = reservation.confirmedPrice ? reservation.confirmedPrice.amount / Math.pow(10, reservation.confirmedPrice.scale) : 0;
    const currency = reservation.confirmedPrice ? reservation.confirmedPrice.currency : 'EUR';

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
            status: paymentStatus,
            totalPrice: totalPrice,
            currency: currency,
            departureDate: formattedDepartureDate,
            arrivalDate: formattedArrivalDate,
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
