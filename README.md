# About
Automatically monitor and reloads the Grafana provisioning config files

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://github.com/user-attachments/assets/06b99b06-6e60-4258-8d7e-dc0897fd8b5a">
  <source media="(prefers-color-scheme: light)" srcset="https://github.com/user-attachments/assets/f6445c39-8377-4187-af96-49876a884ec4">
  <img src="https://github.com/user-attachments/assets/f6445c39-8377-4187-af96-49876a884ec4">
</picture>

## How it works?

- During initial deployment of both Grafana and `grafana-provisioning-config-reloader`, the reloader will attempt to create a service account on Grafana using the default credentials and save it to a persistence storage
- The agent will continuously monitor the provisioning directory for any changes and send request to Grafana Admin HTTP API to [reload the provisioning configurations](https://grafana.com/docs/grafana/latest/developers/http_api/admin/#reload-provisioning-configurations)

The provisioning configurations are stored at `/etc/grafana/provisioning` with the following sub-directory:
- `dashboards`: You can manage dashboards in Grafana by adding one or more YAML config files in this directory.
- `datasources`: You can manage data sources in Grafana by adding YAML configuration files in this directory.
  
See https://grafana.com/docs/grafana/latest/administration/provisioning for more information.

## Usage

See https://github.com/swarmlibs/promstack/blob/main/grafana/docker-stack.yml for a real-world usage example.

## License

Licensed under [MIT](./LICENSE).
