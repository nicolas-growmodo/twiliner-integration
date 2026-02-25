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
    const tripSummaries = reservation.tripSummaries || [];

    if (tripSummaries.length === 0) {
        console.warn('Transformation failed: No trip summaries (legs) in reservation');
        return null;
    }

    const customerEmail = purchaser.email;
    const customerFirstName = purchaser.firstName;
    const customerLastName = purchaser.lastName;
    const customerPhone = purchaser.phone || ''; // Phone might be missing in purchaser detail
    const bookingReference = reservation.id; // Using UUID as reference

    // Determine status roughly based on confirmed price or offers
    // Real logic might need to inspect bookedOfferSummaries statuses
    const paymentStatus = reservation.confirmedPrice && reservation.confirmedPrice.amount > 0 ? 'confirmed' : 'pending';

    const firstLeg = tripSummaries[0];
    const lastLeg = tripSummaries[tripSummaries.length - 1];

    const departureDateStr = firstLeg.startTime;
    const arrivalDateStr = lastLeg.endTime;

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
        return date.toISOString().split('T')[0];
    };

    const formattedPreTravelDate = formatDate(preTravelDate);
    const formattedPostTravelDate = formatDate(postTravelDate);
    const formattedDepartureDate = formatDate(departureDate);
    const formattedArrivalDate = formatDate(arrivalDate);

    // Get origin/dest from StopPlaceRef or similar
    const getPlaceName = (placeObj) => {
        return placeObj && placeObj.stopPlaceRef ? placeObj.stopPlaceRef : 'Unknown';
    };

    const origin = getPlaceName(firstLeg.origin);
    const destination = getPlaceName(lastLeg.destination);

    // Price
    const totalPrice = reservation.confirmedPrice ? reservation.confirmedPrice.amount / Math.pow(10, reservation.confirmedPrice.scale) : 0;
    const currency = reservation.confirmedPrice ? reservation.confirmedPrice.currency : 'EUR';

    // Return standardized structure
    return {
        customer: {
            email: customerEmail,
            firstName: customerFirstName,
            lastName: customerLastName,
            phone: customerPhone
        },
        booking: {
            reference: bookingReference,
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
