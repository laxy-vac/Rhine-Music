/*
 * Copyright (C) 2025 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2025 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 1 мар. 2021 г.
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

#ifndef LSP_PLUG_IN_RESOURCE_ICOMPRESSOR_H_
#define LSP_PLUG_IN_RESOURCE_ICOMPRESSOR_H_

#include <lsp-plug.in/runtime/version.h>
#include <lsp-plug.in/io/OutMemoryStream.h>
#include <lsp-plug.in/io/IOutSequence.h>
#include <lsp-plug.in/io/IOutStream.h>
#include <lsp-plug.in/io/OutBitStream.h>
#include <lsp-plug.in/lltl/darray.h>
#include <lsp-plug.in/lltl/parray.h>
#include <lsp-plug.in/resource/ILoader.h>
#include <lsp-plug.in/resource/buffer.h>
#include <lsp-plug.in/resource/OutProxyStream.h>

namespace lsp
{
    namespace resource
    {
        /**
         * Interface for resource compressor
         */
        class Compressor
        {
            protected:
                lltl::darray<raw_resource_t>    vEntries;
                io::OutMemoryStream             sTemp;          // Temporary buffer
                OutProxyStream                  sOS;            // Output stream
                io::OutBitStream                sOut;           // Output bit stream
                size_t                          nSegment;       // Start of data segment
                size_t                          nOffset;        // Current offset in segment
                cbuffer_t                       sBuffer;        // Buffer for caching

            protected:
                status_t            alloc_entry(raw_resource_t **r, io::Path *path, resource_type_t type);
                wssize_t            write_entry(raw_resource_t *r, io::IInStream *is);
                static size_t       calc_repeats(const uint8_t *head, const uint8_t *tail);
                status_t            emit_uint(size_t value, size_t initial, size_t stepping);
                static size_t       est_uint(size_t value, size_t initial, size_t stepping);

            public:
                explicit Compressor();
                Compressor(const Compressor &) = delete;
                Compressor(Compressor &&) = delete;
                ~Compressor();

                Compressor & operator = (const Compressor &) = delete;
                Compressor & operator = (Compressor &&) = delete;

            public:
                /**
                 * Close the compressor
                 * @return status of operation
                 */
                status_t                close();

                /**
                 * Initialize compressor
                 * @param log_buf_size logarithmic buffer size
                 * @param os output stream
                 * @param flags flags
                 * @return status of operation
                 */
                status_t                init(size_t log_buf_size, io::IOutStream *os, size_t flags = WRAP_NONE);

            public:
                /**
                 * Get all resource entries
                 * @return all resource entries
                 */
                inline const raw_resource_t *entries() const    { return vEntries.array();                                  }

                /**
                 * Get number of resource entries
                 * @return number of resource entries
                 */
                inline size_t           num_entires() const     { return vEntries.size();                                   }

                /**
                 * Start a new segment of data. May be useful for sorting data by different types
                 * @return status of operation
                 */
                status_t                flush();

                /**
                 * Create resource entry and start it's writing
                 * @param name resource entry name
                 * @param is input stream to read entry from
                 * @return number of bytes read from original stream or negative error code
                 */
                wssize_t                create_file(const char *name, io::IInStream *is);
                wssize_t                create_file(const LSPString *name, io::IInStream *is);
                wssize_t                create_file(const io::Path *name, io::IInStream *is);

                /**
                 * Create directory
                 * @param name name of the directory
                 * @return status of operation
                 */
                status_t                create_dir(const char *name);
                status_t                create_dir(const LSPString *name);
                status_t                create_dir(const io::Path *name);
        };

    } /* namespace resource */
} /* namespace lsp */



#endif /* LSP_PLUG_IN_RESOURCE_ICOMPRESSOR_H_ */
