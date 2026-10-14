/*
 * Copyright (C) 2023 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2023 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 24 апр. 2019 г.
 *
 * lsp-runtime-lib is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * any later version.
 *
 * lsp-runtime-lib is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with lsp-runtime-lib. If not, see <https://www.gnu.org/licenses/>.
 */

#ifndef LSP_PLUG_IN_IPC_LIBRARY_H_
#define LSP_PLUG_IN_IPC_LIBRARY_H_

#include <lsp-plug.in/runtime/version.h>
#include <lsp-plug.in/common/types.h>
#include <lsp-plug.in/common/status.h>
#include <lsp-plug.in/io/Path.h>

#if defined(PLATFORM_WINDOWS)
    #include <libloaderapi.h>
#else
    #include <dlfcn.h>
#endif /* PLATFORM_WINDOWS */

namespace lsp
{
    namespace ipc
    {
        /**
         * Class for loading dynamic libraries
         */
        class Library
        {
            private:
            #ifdef PLATFORM_WINDOWS
                HMODULE     hDlSym;
            #else
                void       *hDlSym;
            #endif
                status_t    nLastError;

                static  int hTag;

            public:
                explicit Library();
                Library(const Library &) = delete;
                Library(Library &&) = delete;
                ~Library();

                Library & operator = (const Library &) = delete;
                Library & operator = (Library &&) = delete;

            public:
                /**
                 * Check that library is opened
                 * @return true if library is opened
                 */
                inline bool is_opened() const { return hDlSym != NULL; }

                /**
                 * Return last error
                 * @return last error
                 */
                inline status_t last_error() const { return nLastError; }

                /**
                 * Load library at specified path
                 * @param path UTF-8 path
                 * @param new_space load library into new namespace
                 * @return status of operation
                 */
                status_t open(const char *path, bool new_space = false);

                /**
                 * Load library at specified path
                 * @param path path
                 * @param new_space load library into new namespace
                 * @return status of operation
                 */
                status_t open(const LSPString *path, bool new_space = false);

                /**
                 * Load library at specified path
                 * @param path UTF-8 path
                 * @param new_space load library into new namespace
                 * @return status of operation
                 */
                status_t open(const io::Path *path, bool new_space = false);

                /**
                 * Import symbol from library
                 * @param name symbol name
                 */
                void *import(const char *name);

                /**
                 * Import symbol from library
                 * @param name symbol name
                 */
                void *import(const LSPString *name);

                /**
                 * Unload loaded library
                 * @return status of operation
                 */
                status_t close();

                /**
                 * Swap contents with another library handle
                 * @param dst target library handle to perform swap
                 */
                void swap(Library *dst);

                /**
                 * Get path to the module by the specified address
                 * @param path variable to store path to the module
                 * @param ptr specified address
                 * @return status of operation
                 */
                static status_t get_module_file(LSPString *path, const void *ptr);

                /**
                 * Get path to the module by the specified address
                 * @param path variable to store path to the module
                 * @param ptr specified address
                 * @return status of operation
                 */
                static status_t get_module_file(io::Path *path, const void *ptr);

                /**
                 * Get path to the current module
                 * @param path variable to store path to the current module
                 * @return status of operation
                 */
                static inline status_t get_self_file(LSPString *path) { return get_module_file(path, &hTag); };

                /**
                 * Get path to the current module
                 * @param path variable to store path to the current module
                 * @return status of operation
                 */
                static inline status_t get_self_file(io::Path *path) { return get_module_file(path, &hTag); };

                /**
                 * Check that library file name is valid
                 * @param path UTF-8 path
                 * @return true if library file name is valid
                 */
                static bool valid_library_name(const char *path);

                /**
                 * Check that library file name is valid
                 * @param path UTF-8 path
                 * @return true if library file name is valid
                 */
                static bool valid_library_name(const LSPString *path);

                /**
                 * Check that library file name is valid
                 * @param path UTF-8 path
                 * @return true if library file name is valid
                 */
                static bool valid_library_name(const io::Path *path);
        };
    
    } /* namespace ipc */
} /* namespace lsp */

#endif /* LSP_PLUG_IN_IPC_LIBRARY_H_ */
