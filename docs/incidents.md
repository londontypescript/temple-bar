# Incidents

An incident records something that went wrong while working under
temple-bar's rules: rework, confusion, a rule that made things harder, or a
rule broken. The user saying twice that something is still broken is one
too. Agents see these in the moment; temple-bar's maintainers see which of
them matter across projects. temple-bar's setup wrote this file.

1. **Search first.** Before asking the user anything, search
   [temple-bar's issues](https://github.com/londontypescript/temple-bar/issues),
   all of them, not only incidents. Find incidents by the `incident` label
   and by "incident:" in the title, since not everyone who files one can set
   the label.
2. **If one matches,** name and link it to the user as the known gap, and
   don't propose a new incident. Offer a comment on it only when this case
   adds something it doesn't already say.
3. **If nothing matches,** propose the incident to the user there and then,
   saying the search found nothing.
4. **On the user's yes,** open an issue in temple-bar's issues titled
   `incident: <what went wrong>`, or post the comment you offered. Never in
   this project's own repository, and never with private details (customer
   data, internal hostnames).

The user decides which incidents are raised; temple-bar's maintainers
curate them from there.
