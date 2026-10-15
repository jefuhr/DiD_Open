package nyc.juliet.ferryboard.core

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
enum class NYCFerryMovement {
	@SerialName("pierC") PIER_C,
	@SerialName("crewShuttle") CREW_SHUTTLE,
	@SerialName("outOfService") OUT_OF_SERVICE;

	companion object {
		/** Crew to Pier C remains crew; a departure from the home port is not a return. */
		fun classify(departure: Departure): NYCFerryMovement? = when {
			departure.crewShuttle == true -> CREW_SHUTTLE
			departure.fromHomePort != true && departure.destination.trim().equals("Pier C", ignoreCase = true) -> PIER_C
			departure.outOfService == true -> OUT_OF_SERVICE
			else -> null
		}
	}
}

data class DepartureFilters(
	val hiddenOperators: Set<String> = emptySet(),
	val hiddenRoutes: Set<String> = emptySet(),
	val hiddenNYCMovements: Set<NYCFerryMovement> = emptySet(),
) {
	val isActive: Boolean get() = hiddenOperators.isNotEmpty() || hiddenRoutes.isNotEmpty() || hiddenNYCMovements.isNotEmpty()
	fun allows(routeId: String, operatorName: String): Boolean = operatorName !in hiddenOperators && routeId !in hiddenRoutes
	fun allows(departure: Departure, operatorName: String): Boolean = allows(departure.routeId, operatorName) &&
		(operatorName != "NYC Ferry" || NYCFerryMovement.classify(departure) !in hiddenNYCMovements)
}
