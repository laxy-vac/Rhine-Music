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

#ifndef LSP_PLUG_IN_IO_IOUTSTREAM_H_
#define LSP_PLUG_IN_IO_IOUTSTREAM_H_

#include <lsp-plug.in/runtime/version.h>
#include <lsp-plug.in/common/types.h>
#include <lsp-plug.in/common/status.h>

namespace lsp
{
    namespace io
    {
        class IOutStream
        {
            protected:
                status_t        nErrorCode;

            protected:
                inline status_t set_error(status_t error) { return nErrorCode = error; }

            public:
                explicit IOutStream();
                IOutStream(const IOutStream &) = delete;
                IOutStream(IOutStream &&) = delete;
                virtual ~IOutStream();

                IOutStream & operator = (const IOutStream &) = delete;
                IOutStream & operator = (IOutStream &&) = delete;

            public:
                /** Get last I/O error code
                 *
                 * @return last I/O error code
                 */
                inline status_t     last_error() const { return nErrorCode; };

                /** The current read position
                 *
                 * @return current write position or error code
                 */
                virtual wssize_t    position();

                /** Write the data to output stream.
                 * The implementation should write the most possible amount
                 * of bytes before exit. Such behaviour will simplify the caller's
                 * implementation.
                 *
                 * @param buf buffer to write
                 * @param count number of bytes
                 * @return number of bytes actually written or negative error code
                 */
                virtual ssize_t     write(const void *buf, size_t count);

                /**
                 * Write a single byte to underlying storage
                 * @param v byte to write
                 * @deprecated use write_byte
                 * @return number of bytes actually written or negative error code
                 */
                [[deprecated]]
                virtual ssize_t     writeb(int v);

                /**
                 * Write a single byte to underlying storage
                 * @param v byte to write
                 * @return number of bytes actually written or negative error code
                 */
                virtual status_t    write_byte(int v);

                /** Seek the stream to the specified position from the beginning
                 *
                 * @param position the specified position
                 * @return real position or negative value on error
                 */
                virtual wssize_t    seek(wsize_t position);

                /**
                 * Flush buffers to underlying storage
                 * @return status of operation
                 */
                virtual status_t    flush();

                /** Close the clip data stream
                 *
                 * @return status of operation
                 */
                virtual status_t    close();
        };

        /**
         * Finalize output stream according to wrapping flags
         * @param os output stream to finalize
         * @param wrap_flags wrap fiags
         * @return status of operation
         */
        status_t finalize(io::IOutStream *os, size_t wrap_flags);
    
    } /* namespace io */
} /* namespace lsp */

#endif /* LSP_PLUG_IN_IO_IOUTSTREAM_H_ */
