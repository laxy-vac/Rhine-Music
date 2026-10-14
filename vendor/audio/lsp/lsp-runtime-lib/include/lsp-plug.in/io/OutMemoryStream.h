/*
 * Copyright (C) 2023 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2023 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 19 авг. 2019 г.
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

#ifndef LSP_PLUG_IN_IO_OUTMEMORYSTREAM_H_
#define LSP_PLUG_IN_IO_OUTMEMORYSTREAM_H_

#include <lsp-plug.in/runtime/version.h>
#include <lsp-plug.in/io/IOutStream.h>

namespace lsp
{
    namespace io
    {
        
        class OutMemoryStream: public IOutStream
        {
            private:
                uint8_t    *pData;
                size_t      nSize;
                size_t      nCapacity;
                size_t      nQuantity;
                size_t      nPosition;

            public:
                explicit OutMemoryStream();
                explicit OutMemoryStream(size_t quantity);
                OutMemoryStream(const OutMemoryStream &) = delete;
                OutMemoryStream(OutMemoryStream &&) = delete;
                virtual ~OutMemoryStream() override;

                OutMemoryStream & operator = (const OutMemoryStream &) = delete;
                OutMemoryStream & operator = (OutMemoryStream &&) = delete;

            public:
                /**
                 * Get current contents of the memory buffer
                 * @return contents of the memory buffer, may be NULL if there is no data
                 */
                const uint8_t  *data() const        { return pData; }

                /**
                 * Get current size of memory buffer
                 * @return size of memory buffer
                 */
                const size_t    size() const        { return nSize; }

                /**
                 * Get capacity of the memory buffer
                 * @return capacity of the memory buffer
                 */
                const size_t    capacity() const    { return nCapacity; }

                /**
                 * Get grow quantity of the memory buffer
                 * @return grow quantity
                 */
                const size_t    quantity() const    { return nQuantity; }

                /**
                 * Release the internal buffer and return it's contents
                 * @return the pointer to data that should be free()'d after use
                 */
                uint8_t        *release();

                /**
                 * Drop internal stream data and reset position
                 */
                void            drop();

                /** Reset the size of memory buffer
                 *
                 */
                void            clear();

                /** Reduce the buffer size to the specified value if it was greater
                 * @return true if the size has been reduced
                 */
                bool            reduce(size_t size);

                /**
                 * Reserve amount of data
                 * @param amount amount of bytes to reserve
                 * @return status of operation
                 */
                status_t        reserve(size_t amount);

            public: // io::IOutStream
                virtual wssize_t    position() override;
                virtual ssize_t     write(const void *buf, size_t count) override;
                virtual ssize_t     writeb(int v) override;
                virtual status_t    write_byte(int v) override;
                virtual wssize_t    seek(wsize_t position) override;
                virtual status_t    flush() override;
                virtual status_t    close() override;
        };
    
    } /* namespace io */
} /* namespace lsp */

#endif /* LSP_PLUG_IN_IO_OUTMEMORYSTREAM_H_ */
