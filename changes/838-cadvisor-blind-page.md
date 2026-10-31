### Added
- JagHelm now pages a warning when a node has had no container readings from cAdvisor for two failed cycles ("Container readings on <node>: no container readings, so container alerts for <node> are blind"), and sends a recovery when the readings return. It replaces the cAdvisor part of Grafana's Monitoring gap rule. A node cAdvisor never covers does not page.
