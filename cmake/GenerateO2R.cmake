foreach(REQUIRED_VARIABLE TORCH_EXECUTABLE SOURCE_DIR BINARY_DIR)
  if(NOT DEFINED ${REQUIRED_VARIABLE})
    message(FATAL_ERROR "${REQUIRED_VARIABLE} is required")
  endif()
endforeach()

file(LOCK "${BINARY_DIR}/spaghetti-o2r.lock" GUARD PROCESS TIMEOUT 300)
execute_process(
  COMMAND "${TORCH_EXECUTABLE}" pack assets spaghetti.o2r o2r
  WORKING_DIRECTORY "${SOURCE_DIR}"
  RESULT_VARIABLE GENERATE_RESULT)
if(NOT GENERATE_RESULT EQUAL 0)
  message(FATAL_ERROR "Torch failed to generate spaghetti.o2r")
endif()

execute_process(
  COMMAND "${CMAKE_COMMAND}" -E copy_if_different
          "${SOURCE_DIR}/spaghetti.o2r" "${BINARY_DIR}/spaghetti.o2r"
  RESULT_VARIABLE COPY_RESULT)
if(NOT COPY_RESULT EQUAL 0)
  message(FATAL_ERROR "Failed to stage spaghetti.o2r")
endif()

# Also refresh the running app bundle when it already exists. The app target's
# POST_BUILD only runs on a binary relink, so an assets-only rebuild used to
# leave Contents/Resources/spaghetti.o2r stale (e.g. custom 5P–8P menu icons).
set(_APP_O2R "${BINARY_DIR}/SpaghettiKart.app/Contents/Resources/spaghetti.o2r")
if(EXISTS "${BINARY_DIR}/SpaghettiKart.app/Contents/Resources")
  execute_process(
    COMMAND "${CMAKE_COMMAND}" -E copy_if_different
            "${BINARY_DIR}/spaghetti.o2r" "${_APP_O2R}"
    RESULT_VARIABLE APP_COPY_RESULT)
  if(NOT APP_COPY_RESULT EQUAL 0)
    message(WARNING "Failed to refresh app-bundle spaghetti.o2r")
  endif()
endif()
