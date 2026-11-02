# Times kelpto-md against cmark; see ../README.md. Builds the C++ that
# `temper build -b cpp` generates at the repo's top, and cmark from its
# release source, pinned by hash:
#
#     cmake -B build -DCMAKE_BUILD_TYPE=Release && cmake --build build -j 2
#     ./build/bench time PLAN

cmake_minimum_required(VERSION 3.16)
project(kelpto_bench C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release)
endif()

include(FetchContent)
set(BUILD_SHARED_LIBS OFF)
set(BUILD_TESTING OFF)
FetchContent_Declare(
  cmark
  URL https://github.com/commonmark/cmark/archive/refs/tags/0.31.2.tar.gz
  URL_HASH SHA256=f9bc5ca38bcb0b727f0056100fac4d743e768872e3bacec7746de28f5700d697
  DOWNLOAD_EXTRACT_TIMESTAMP TRUE
)
FetchContent_MakeAvailable(cmark)

set(TEMPER_OUT ${CMAKE_CURRENT_SOURCE_DIR}/../../temper.out/cpp)
file(GLOB STD_SOURCES ${TEMPER_OUT}/std/*.cpp)
list(FILTER STD_SOURCES EXCLUDE REGEX "/main\\.cpp$")
add_library(kelpto_md ${TEMPER_OUT}/kelpto-md/init.cpp ${TEMPER_OUT}/kelpto-core/init.cpp ${STD_SOURCES})
target_include_directories(kelpto_md PUBLIC ${TEMPER_OUT})

add_executable(bench bench.cpp)
target_link_libraries(bench PRIVATE kelpto_md cmark)
