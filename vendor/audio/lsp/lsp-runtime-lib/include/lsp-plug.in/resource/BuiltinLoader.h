/*
 * Copyright (C) 2024 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2024 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 15 мар. 2021 г.
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

#ifndef LSP_PLUG_IN_RESOURCE_BUILTINLOADER_H_
#define LSP_PLUG_IN_RESOURCE_BUILTINLOADER_H_

#include <lsp-plug.in/runtime/version.h>
#include <lsp-plug.in/common/types.h>
#include <lsp-plug.in/runtime/LSPString.h>
#include <lsp-plug.in/io/Path.h>

#include <lsp-plug.in/resource/types.h>
#include <lsp-plug.in/resource/ILoader.h>

namespace lsp
{
    namespace resource
    {
        /**
         * Loader for built-in resources
         */
        class BuiltinLoader: public ILoader
        {
            protected:
                const uint8_t                  *pData;      // Compressed data
                size_t                          nDataSize;  // Data size
                const raw_resource_t           *pCatalog;   // Catalog
                size_t                          nCatSize;   // Catalog size
                size_t                          nBufRank;   // Size of compression buffer

            protected:
                status_t                        find_entry(ssize_t *out, const io::Path *path);

            public:
                explicit BuiltinLoader();
                BuiltinLoader(const BuiltinLoader &) = delete;
                BuiltinLoader(BuiltinLoader &&) = delete;
                virtual ~BuiltinLoader() override;

                BuiltinLoader & operator = (const BuiltinLoader & ) = delete;
                BuiltinLoader & operator = (BuiltinLoader && ) = delete;

            public:
                /**
                 * Initialize builtin loader
                 *
                 * @param data compression data
                 * @param data_size size of compression data
                 * @param catalog catalog with entries
                 * @param catalog_size size of catalog
                 * @param log_buf_size size of compression buffer (the exponent of power-of-two value)
                 * @return status of operation
                 */
                status_t init(
                    const void *data, size_t data_size,
                    const raw_resource_t *catalog, size_t catalog_size,
                    size_t log_buf_size);

            public:
                virtual io::IInStream      *read_stream(const io::Path *name) override;

                virtual ssize_t             enumerate(const io::Path *path, resource_t **list) override;
        };
    } /* namespace resource */
} /* namespace lsp */

#endif /* LSP_PLUG_IN_RESOURCE_BUILTINLOADER_H_ */
