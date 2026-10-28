# Sourced by the build and deploy scripts: loads LUMEN_* settings from the repo-root .env (see .env.example).
# A variable that is already set in the environment wins over .env.
if [ -f "$ROOT/.env" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      LUMEN_*=*|CHROME=*)
        k=${line%%=*}; v=${line#*=}
        case "$k" in *[!A-Z0-9_]*) continue ;; esac
        v=${v#\"}; v=${v%\"}; v=${v#\'}; v=${v%\'}
        eval "isset=\${$k+x}"
        [ -n "$isset" ] || export "$k=$v"
        ;;
    esac
  done < "$ROOT/.env"
fi
