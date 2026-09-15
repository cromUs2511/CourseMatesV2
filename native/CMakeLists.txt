cmake_minimum_required(VERSION 3.18)
project(coursemates_native LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
  set(CMAKE_BUILD_TYPE Release CACHE STRING "" FORCE)
endif()

# Development.Module (not Development) is what lets this build against a
# Python that ships no static lib - the normal case on Linux distro Pythons
# and inside manylinux containers.
find_package(Python 3.10 REQUIRED COMPONENTS Interpreter Development.Module)

# Ask the installed pybind11 where its CMake package lives, so a plain
# `pip install pybind11` in a venv is enough and no vendored copy is needed.
if(NOT pybind11_DIR)
  execute_process(
    COMMAND "${Python_EXECUTABLE}" -m pybind11 --cmakedir
    OUTPUT_VARIABLE _pybind11_cmakedir
    OUTPUT_STRIP_TRAILING_WHITESPACE
    RESULT_VARIABLE _pybind11_probe)
  if(_pybind11_probe EQUAL 0)
    set(pybind11_DIR "${_pybind11_cmakedir}")
  endif()
endif()
find_package(pybind11 CONFIG REQUIRED)

pybind11_add_module(coursemates_native MODULE src/bindings.cpp)

target_include_directories(coursemates_native PRIVATE src)
target_compile_definitions(coursemates_native
  PRIVATE CM_VERSION_INFO="${SKBUILD_PROJECT_VERSION}")

if(MSVC)
  # /utf-8      - the sources contain UTF-8 comments; without this MSVC reads
  #               them in the system ANSI codepage and emits C4819 (or worse,
  #               mangles a string literal).
  # /permissive- - stops MSVC from accepting non-conforming code that then
  #               fails on GCC/Clang in CI.
  target_compile_options(coursemates_native PRIVATE /O2 /EHsc /utf-8 /permissive- /W4)
else()
  target_compile_options(coursemates_native PRIVATE
    -O3 -Wall -Wextra -Wpedantic -fvisibility=hidden -fstack-protector-strong)
  # Turns silent UB on out-of-range vector indexing into a loud abort. Costs a
  # few percent; worth it in a process that must not corrupt other sessions.
  target_compile_definitions(coursemates_native PRIVATE _GLIBCXX_ASSERTIONS)
endif()

# -DCM_SANITIZE=ON for the CI job that runs the Python test suite under
# AddressSanitizer + UBSan. Never ship a sanitized wheel.
option(CM_SANITIZE "Build with ASan/UBSan" OFF)
if(CM_SANITIZE AND NOT MSVC)
  target_compile_options(coursemates_native PRIVATE
    -fsanitize=address,undefined -fno-omit-frame-pointer -O1)
  target_link_options(coursemates_native PRIVATE -fsanitize=address,undefined)
endif()

install(TARGETS coursemates_native LIBRARY DESTINATION .)
