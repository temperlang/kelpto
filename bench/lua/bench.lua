-- Times kelpto-md in Lua, for scripts/bench.py. Lua has no usual
-- Markdown parser here to compare with, so this gives kelpto-md's own
-- times. Run from this directory:
--
--     lua bench.lua time PLAN
--     lua bench.lua mem LIBRARY TASK FILE
--
-- See ../README.md for the plan format and what each task does. Times
-- are the process's CPU time (os.clock), since plain Lua has no finer
-- wall clock; the bench is single-threaded, so they match closely.

package.path = "../../temper.out/lua/?/init.lua;../../temper.out/lua/?.lua;" .. package.path

local md = require("kelpto-md")
local instance_of = require("temper-core").instance_of

local function kelpto()
  local parser = md.MarkdownParser.commonMark
  local renderer = md.MarkdownRenderer():withRawHtmlTrusted()
  local Heading = md.Heading
  return {
    parse = function(text) return parser:parse(text).span.end_ end,
    render = function(text) return #renderer:render(parser:parse(text)) end,
    walk = function(text)
      local doc = parser:parse(text)
      local views = doc.descendants
      local headings = 0
      for _, view in ipairs(views) do
        if instance_of(view, Heading) then headings = headings + 1 end
      end
      return #views + headings + #doc.asWritten
    end,
    transform = function(text)
      local doc = parser:parse(text)
      local editor = doc:editor()
      for _, heading in ipairs(doc.headings) do
        local level = heading.level
        if level < 6 and not (level == 2 and heading.style == "setext") then
          editor:setLevel(heading, level + 1)
        end
      end
      return #editor:toDocument().asWritten
    end,
  }
end

local libraries = {
  kelpto = kelpto,
  none = function() return { read = function(text) return #text end } end,
}

local function read(path)
  local file = assert(io.open(path, "rb"))
  local text = file:read("a")
  file:close()
  return text
end

local function split(line, sep)
  local out = {}
  for field in string.gmatch(line, "[^" .. sep .. "]+") do out[#out + 1] = field end
  return out
end

local mode = arg[1]
if mode == "mem" then
  print(libraries[arg[2]]()[arg[3]](read(arg[4])))
  return
end
local lines = {}
for line in io.lines(arg[2]) do
  if #line > 0 then lines[#lines + 1] = line end
end
local head = split(lines[1], " ")
local warmup_ms, sample_ms, max_samples, budget_ms = tonumber(head[1]), tonumber(head[2]), tonumber(head[3]), tonumber(head[4])
local made = {}
for i = 2, #lines do
  local job = split(lines[i], "\t")
  made[job[1]] = made[job[1]] or libraries[job[1]]()
  local op = made[job[1]][job[2]]
  local text = read(job[3])
  local count, check, elapsed = 0, nil, 0
  local start = os.clock()
  repeat
    check = op(text)
    count = count + 1
    elapsed = os.clock() - start
  until elapsed * 1000 >= warmup_ms and count >= 2
  local per_op = elapsed / count
  local inner = math.max(1, math.floor(sample_ms / 1000 / per_op + 0.5))
  local samples = math.max(3, math.min(max_samples, math.floor(budget_ms / 1000 / (per_op * inner))))
  local times = {}
  for s = 1, samples do
    collectgarbage("collect")
    local begin = os.clock()
    for _ = 1, inner do op(text) end
    times[s] = string.format("%.9e", (os.clock() - begin) / inner)
  end
  print(table.concat({ job[1], job[2], job[3], tostring(inner), tostring(check), table.concat(times, " ") }, "\t"))
  io.stdout:flush()
end
