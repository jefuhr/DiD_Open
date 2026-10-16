package nyc.juliet.ferrykitty.ui.sheets

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import nyc.juliet.ferrykitty.core.Landing
import nyc.juliet.ferrykitty.ui.components.SearchField
import nyc.juliet.ferrykitty.ui.components.TouchTarget
import nyc.juliet.ferrykitty.ui.theme.ferryColors

/**
 * Picks one landing from a searchable list, favorites first and in bold, as iOS pickers do. [noneLabel] adds a first
 * choice for "no landing", such as Server default.
 */
@Composable
internal fun LandingChoiceDialog(
	title: String,
	landings: List<Landing>,
	favorites: Set<Int>,
	selected: Int?,
	tag: String,
	noneLabel: String?,
	onSelect: (Landing?) -> Unit,
	onDismiss: () -> Unit,
) {
	var search by rememberSaveable { mutableStateOf("") }
	val choices = remember(landings, favorites, search) { FilterLogic.landings(landings, search, favorites) }
	Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
		Surface(
			shape = RoundedCornerShape(24.dp),
			color = ferryColors.card,
			contentColor = ferryColors.ink,
			modifier = Modifier.padding(24.dp).widthIn(max = 520.dp).fillMaxWidth(),
		) {
			Column(Modifier.padding(top = 20.dp, bottom = 8.dp)) {
				Text(title, style = MaterialTheme.typography.titleLarge, color = ferryColors.heading,
					modifier = Modifier.padding(horizontal = 24.dp).semantics { heading() })
				SearchField(search, { search = it }, "Landing name or number", Modifier.padding(horizontal = 16.dp, vertical = 10.dp), tag = "$tag-search")
				LazyColumn(Modifier.fillMaxWidth().heightIn(max = 420.dp)) {
					if (noneLabel != null && search.isBlank()) {
						item(key = "none") { ChoiceLine(noneLabel, favorite = false, current = selected == null, tag = "$tag-default") { onSelect(null) } }
					}
					items(choices, key = { it.id }) { landing ->
						ChoiceLine(landing.displayName, favorite = landing.id in favorites, current = landing.id == selected, tag = "$tag-${landing.id}") { onSelect(landing) }
					}
					if (choices.isEmpty()) item(key = "empty") {
						Text(if (landings.isEmpty()) "Connect to load the landing list." else "No matching landings.", color = ferryColors.muted,
							modifier = Modifier.padding(24.dp))
					}
				}
				TextButton(onClick = onDismiss, modifier = Modifier.align(Alignment.End).padding(horizontal = 12.dp)) { Text("Cancel") }
			}
		}
	}
}

@Composable
private fun ChoiceLine(label: String, favorite: Boolean, current: Boolean, tag: String, onClick: () -> Unit) {
	Row(
		verticalAlignment = Alignment.CenterVertically,
		horizontalArrangement = Arrangement.spacedBy(10.dp),
		modifier = Modifier
			.fillMaxWidth()
			.testTag(tag)
			.clickable(role = Role.RadioButton, onClick = onClick)
			.semantics { selected = current }
			.heightIn(min = TouchTarget)
			.padding(horizontal = 24.dp),
	) {
		Text(label, style = MaterialTheme.typography.bodyLarge, fontWeight = if (favorite) FontWeight.Bold else FontWeight.Normal,
			color = ferryColors.ink, modifier = Modifier.weight(1f))
		if (favorite) Icon(Icons.Filled.Star, contentDescription = "Favorite", tint = ferryColors.warning, modifier = Modifier.size(16.dp))
		if (current) Icon(Icons.Filled.Check, contentDescription = "Selected", tint = ferryColors.accent, modifier = Modifier.size(20.dp))
	}
}
