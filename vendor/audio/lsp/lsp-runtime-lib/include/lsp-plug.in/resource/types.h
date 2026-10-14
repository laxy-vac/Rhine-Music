/*
 * Copyright (C) 2020 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2020 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 26 окт. 2020 г.
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

#ifndef LSP_PLUG_IN_RESOURCE_TYPES_H_
#define LSP_PLUG_IN_RESOURCE_TYPES_H_

#include <lsp-plug.in/runtime/version.h>
#include <lsp-plug.in/common/types.h>

namespace lsp
{
    namespace resource
    {
        static const size_t RESOURCE_NAME_MAX       = 64;

        enum resource_type_t
        {
            RES_FILE,
            RES_DIR
        };
        
        /**
         * Resource descriptor
         */
        typedef struct resource_t
        {
            resource_type_t     type;
            char                name[RESOURCE_NAME_MAX];
        } resource_t;

        /**
         * Raw resource descriptor
         */
        typedef struct raw_resource_t
        {
            resource_type_t         type;                       // Type of resource
            const char             *name;                       // Name of resource
            int32_t                 parent;                     // Index of parent resource (negative if none)
            int32_t                 segment;                    // The start of segment
            int32_t                 offset;                     // Offset of the resource
            uint32_t                length;                     // Length of the resource
        } raw_resource_t;

        /**
         * Raw resource storage
         */
        typedef struct raw_storage_t
        {
            const char             *data;                       // The resource data
            const char             *commands;                   // The list of compression commands
            const raw_resource_t   *resources;                  // The list of built-in resources
        } raw_storage_t;
    }
}

#endif /* LSP_PLUG_IN_RESOURCE_TYPES_H_ */
