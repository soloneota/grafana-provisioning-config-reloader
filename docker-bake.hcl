target "docker-metadata-action" {}
target "github-metadata-action" {}

target "default" {
    inherits = [ "grafana-provisioning-config-reloader" ]
    platforms = [
        "linux/amd64",
        "linux/arm64"
    ]
}

target "local" {
    inherits = [ "grafana-provisioning-config-reloader" ]
    tags = [ "swarmlibs/grafana-provisioning-config-reloader:local" ]
}

target "grafana-provisioning-config-reloader" {
    context = "."
    dockerfile = "Dockerfile"
    inherits = [
        "docker-metadata-action",
        "github-metadata-action",
    ]
}
