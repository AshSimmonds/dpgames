local function formatTable(table)
  local str = "{ "
  for k, v in pairs(table) do
    str = str .. k .. ": " .. v .. ", "
  end
  return str .. "}"
end

local function exportSpriteSheet(spr)
  local texturePath = string.gsub(spr.filename, ".aseprite", ".png")
  local modulePath = string.gsub(spr.filename, ".aseprite", ".ts")
  local importUrl = "./" .. texturePath:match("^.+/(.+)$")

  local lines = {
    "// Generated by 'Export TypeScript Sprites' Aseprite Extension",
    string.format('import url from "%s"', importUrl),
  }

  for _, slice in ipairs(spr.slices) do
    local props = {
      url="url",
      x=slice.bounds.x,
      y=slice.bounds.y,
      w=slice.bounds.width,
      h=slice.bounds.height,
    }

    if slice.center then
      props.center = formatTable({
        x=slice.center.x,
        y=slice.center.y,
        w=slice.center.width,
        h=slice.center.height,
      })
    end

    if slice.pivot then
      props.pivot = formatTable{
        x=slice.pivot.x,
        y=slice.pivot.y,
      }
    end

    local line = string.format(
      'export const %s = %s;',
      slice.name,
      formatTable(props)
    )

    table.insert(lines, line)
  end

  local src = table.concat(lines, "\n")
  local file = io.open(modulePath, "w")

  if file then
    file:write(src)
    file:close()
  end

  app.command.ExportSpriteSheet{
    ui=false,
    textureFilename=texturePath,
  }
end

function init(plugin)
  plugin:newCommand{
    id="ExportTypeScriptSprites",
    title="Export TypeScript",
    group="file_export",
    onclick=function()
      exportSpriteSheet(app.activeSprite)
    end
  }
end
