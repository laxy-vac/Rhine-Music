/*
 * Copyright (C) 2024 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2024 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 14 нояб. 2017 г.
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

#ifndef LSP_PLUG_IN_IO_IINSTREAM_H_
#define LSP_PLUG_IN_IO_IINSTREAM_H_

#include <lsp-plug.in/runtime/version.h>
#include <lsp-plug.in/common/types.h>
#include <lsp-plug.in/common/status.h>

namespace lsp
{
    namespace io
    {
        class IOutStream;
        
        /** This is data stream available to be read from clipboard
         *
         */
        class IInStream
        {
            protected:
                status_t        nErrorCode;

            protected:
                inline status_t set_error(status_t error) { return nErrorCode = error; }

            public:
                explicit IInStream();
                IInStream(const IInStream &) = delete;
                IInStream(IInStream &&) = delete;
                virtual ~IInStream();

                IInStream & operator = (const IInStream &) = delete;
                IInStream & operator = (IInStream &&) = delete;

            public:
                /** Get last I/O error code
                 *
                 * @return last I/O error code
                 */
                inline status_t     last_error() const { return nErrorCode; };

                /** The number of bytes available
                 *
                 * @return number of bytes available or negative error code
                 * @note some implementations can return STATUS_NOT_IMPLEMENTED error code
                 */
                virtual wssize_t    avail();

                /** The current read position
                 *
                 * @return current read position or negative error code
                 */
                virtual wssize_t    position();

                /** Read single byte from stream
                 *
                 * @return byte value or negative error code
                 */
                virtual ssize_t     read_byte();

                /** Read amount of data
                 *
                 * @param dst target buffer to read data
                 * @param count number of bytes to read
                 * @return number of bytes actually read or negative error code,
                 *   for end of file, -STATUS_EOF should be returned
                 */
                virtual ssize_t     read(void *dst, size_t count);

                /** Read maximum possible amount of data
                 *
                 * @param dst target buffer to read data
                 * @param count number of bytes to read
                 * @return number of bytes actually read
                 */
                virtual ssize_t     read_fully(void *dst, size_t count);

                /**
                 * Read entire block of specified size
                 * @param dst target buffer to read block
                 * @param count number of bytes in block
                 * @return status of operation
                 */
                virtual status_t    read_block(void *dst, size_t count);

                /** Seek the stream to the specified position from the beginning
                 *
                 * @param position the specified position
                 * @return real position or negative value on error
                 * @note some implementations can return STATUS_NOT_IMPLEMENTED error code
                 */
                virtual wssize_t    seek(wsize_t position);

                /**
                 * Skip amount of data
                 * @param amount amount of bytes to skip
                 * @return actual number of bytes skipped or error
                 */
                virtual wssize_t    skip(wsize_t amount);

                /**
                 * Sink all data to the output stream
                 * @param os pointer to the output stream
                 * @return number of bytes written or negative error code
                 */
                virtual wssize_t    sink(IOutStream *os, size_t buf_size = 0x1000);

                /** Close the clip data stream
                 *
                 * @return status of operation
                 */
                virtual status_t    close();
        };
    
        /**
         * Finalize input stream according to wrapping flags
         * @param is input stream to finalize
         * @param wrap_flags wrap fiags
         * @return status of operation
         */
        status_t finalize(io::IInStream *is, size_t wrap_flags);

    } /* namespace io */
} /* namespace lsp */

#endif /* LSP_PLUG_IN_IO_IINSTREAM_H_ */
