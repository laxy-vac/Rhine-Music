/*
 * Copyright (C) 2025 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2025 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 29 авг. 2019 г.
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

#ifndef LSP_PLUG_IN_FMT_JAVA_HANDLES_H_
#define LSP_PLUG_IN_FMT_JAVA_HANDLES_H_

#include <lsp-plug.in/runtime/version.h>
#include <lsp-plug.in/common/types.h>
#include <lsp-plug.in/common/status.h>
#include <lsp-plug.in/fmt/java/Object.h>

namespace lsp
{
    namespace java
    {
        /**
         * This is implementation of storage for handles read from
         * the object stream
         */
        class Handles
        {
            protected:
                size_t          nCapacity;
                Object        **vItems;
                size_t          nHandle;

            public:
                explicit Handles();
                Handles(const Handles &) = delete;
                Handles(Handles &&) = delete;
                ~Handles();
            
                Handles & operator = (const Handles &) = delete;
                Handles & operator = (Handles &&) = delete;

            public:
                /**
                 * Allocate new handle identifier
                 * @return handle identifier
                 */
                inline size_t       new_handle() { return nHandle++; }

                /**
                 * Return number of handles
                 * @return number of handles
                 */
                inline size_t       handles() const { return nHandle; }

                /**
                 * Resolve the java object
                 * @param handle java object handle
                 * @return resolved java object or NULL if not exist
                 */
                Object *get(size_t handle);

                /**
                 * Bind object to the specified handle
                 * @param obj java object
                 * @return status of operation
                 */
                status_t assign(Object *obj);

                /**
                 * Clear handle registry and free handle table
                 */
                void    clear();

                /**
                 * Flush handle registry and free handle table
                 */
                void    flush();
        };
    
    } /* namespace java */
} /* namespace lsp */

#endif /* LSP_PLUG_IN_FMT_JAVA_OBJECTRESOLVER_H_ */
