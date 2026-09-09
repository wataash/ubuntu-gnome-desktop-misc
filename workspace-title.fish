# Source from interactive config.fish. No hooks outside local Tilix shells.
status is-interactive || return
set -q TILIX_ID || return
set -q SSH_CONNECTION && return
set -g __workspace_title_root $(path dirname $(status filename))
fish_add_path --path $__workspace_title_root/bin/

function __workspace_title_register --on-event fish_preexec
    command workspace-title -q --shell-pid $fish_pid register
end

function __workspace_title_cwd --on-event fish_prompt --on-variable PWD
    command workspace-title -q --shell-pid $fish_pid cwd
end
