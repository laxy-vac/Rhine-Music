/*
 * Copyright (C) 2025 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2025 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 21 авг. 2019 г.
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

#ifndef LSP_PLUG_IN_IO_INMEMORYSTREAM_H_
#define LSP_PLUG_IN_IO_INMEMORYSTREAM_H_

#include <lsp-plug.in/runtime/version.h>
#include <lsp-plug.in/io/IInStream.h>
#include <lsp-plug.in/io/OutMemoryStream.h>

namespace lsp
{
    namespace io
    {
        /**
         * Input stream around the flat chunk of memory.
         */
        class InMemoryStream: public IInStream
        {
            protected:
                uint8_t        *pData;
                size_t          nOffset;
                size_t          nSize;
                lsp_memdrop_t   enDrop;

            public:
                explicit InMemoryStream();

                /**
                 * Create memory input stream
                 * @param data associated buffer
                 * @param size size of buffer
                 */
                explicit InMemoryStream(const void *data, size_t size);

                /**
                 * Create memory input stream
                 * @param data associated buffer
                 * @param size size of buffer
                 * @param drop the method how to drop data on close()
                 */
                explicit InMemoryStream(void *data, size_t size, lsp_memdrop_t drop);

                virtual ~InMemoryStream() override;

                InMemoryStream(const InMemoryStream &) = delete;
                InMemoryStream(InMemoryStream &&) = delete;

                InMemoryStream & operator = (const InMemoryStream &) = delete;
                InMemoryStream & operator = (InMemoryStream &&) = delete;

            public:
                /**
                 * Wrap the memory buffer, drop previous buffer using specified mechanism
                 * @param data associated buffer
                 * @param size size of buffer
                 * @param drop the method how to drop data on close()
                 */
                void wrap(void *data, size_t size, lsp_memdrop_t drop);

                /**
                 * Wrap the memory buffer, drop previous buffer using specified mechanism
                 * @param data associated buffer
                 * @param size size of buffer
                 */
                void wrap(const void *data, size_t size);

                /**
                 * Get the memory contents
                 * @return memory contents
                 */
                inline const uint8_t *data() const { return pData; }

                /**
                 * Drop data using specified drop mechanism
                 * @return true if data has been dropped
                 */
                bool drop(lsp_memdrop_t drop);

                /**
                 * Drop data using default mechanism specified in constructor
                 * @return true if data has been dropped
                 */
                inline bool drop() { return drop(enDrop); };

                /**
                 * Obtain the size of memory buffer wrapped by the memory stream
                 * @return the size of memory buffer in bytes
                 */
                inline size_t       size() const { return nSize;    }

                void                take(OutMemoryStream &src);
                void                take(OutMemoryStream *src);

            public: // io::IInStream
                virtual wssize_t    avail() override;
                virtual wssize_t    position() override;
                virtual ssize_t     read(void *dst, size_t count) override;
                virtual ssize_t     read_byte() override;
                virtual wssize_t    seek(wsize_t position) override;
                virtual wssize_t    skip(wsize_t amount) override;
                virtual status_t    close() override;
        };
    
    } /* namespace io */
} /* namespace lsp */

#endif /* LSP_PLUG_IN_IO_INMEMORYSTREAM_H_ */
