-- Finds the libraries `temper build` generates at the repo's top, for
-- `lua -l paths tour.lua`.
package.path = "../../../temper.out/lua/?/init.lua;../../../temper.out/lua/?.lua;" .. package.path
